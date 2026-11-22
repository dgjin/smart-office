import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { User } from '../types.ts';
import { getDbPool } from './db.ts';
import { DbError } from './errors.ts';
import { writeAudit } from './audit.ts';

/*
 * 总部楼层 3D 分布图的数据面。
 *
 * 存两条互不干扰的线：
 *  · 布局基线（hq3d_building / hq3d_floor / hq3d_room）—— 由 Excel 解析来的只读数据，
 *    只能通过 scripts/db/seed-hq3d.ts 重建，界面上改不动。
 *  · 业务覆盖（hq3d_room_profile / hq3d_room_maintenance / hq3d_floor.area_total）——
 *    房间改名、换人、报修、楼层面积合计，全部落这几张表。
 *
 * 为什么不用 mutateDb：那套是「整库 JSON 快照重写」，一次写入会把 20+ 集合全量 upsert。
 * 3D 图有 427 间房、改动粒度是一间房一条记录，走快照会白写几百 KB，
 * 也会把 3D 的编辑卷进排班/预订的乐观锁里互相打架。
 */

const EDITABLE_TEXT_FIELDS = ['label', 'person', 'dept', 'notes', 'category'] as const;
type EditableTextField = (typeof EDITABLE_TEXT_FIELDS)[number];

const MAINTENANCE_STATUSES = ['open', 'doing', 'done'] as const;
type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

const MAINTENANCE_TYPES = ['空调', '给排水', '照明', '门禁', '家具', '网络', '消防', '其他'];
const MAINTAINABLE_CATEGORIES = ['office', 'open', 'exec', 'meeting'];

const FIELD_LABEL: Record<string, string> = {
  label: '房间名',
  person: '使用人',
  dept: '部门',
  notes: '备注',
  category: '功能类别',
  areaSqm: '面积'
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const asIso = (value: unknown) => (value ? new Date(value as string | Date).toISOString() : null);
const clampText = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new DbError('TEXT_TOO_LONG', 400, { max });
  return text;
};

export type Hq3dRoomProfile = {
  uid: string;
  label?: string;
  person?: string;
  dept?: string;
  notes?: string;
  category?: string;
  areaSqm?: number;
  history: Array<{ field: string; fieldLabel: string; from: string; to: string; by: string; at: string }>;
  updatedBy?: string;
  updatedAt?: string;
};

export type Hq3dMaintenanceRecord = {
  id: string;
  roomUid: string;
  type: string;
  title: string;
  note: string;
  reporter: string;
  status: MaintenanceStatus;
  createdAt: string;
  updatedAt: string;
};

export type Hq3dResourceMapping = {
  roomUid: string;
  resourceId: string;
  planId: string;
  decisionRef: string;
  decisionBasis: string;
  note: string;
};

export type Hq3dRoomDisposition = {
  roomUid: string;
  disposition: 'DISPLAY_ONLY' | 'BOOKABLE_CANDIDATE';
  reviewStatus: 'APPLIED' | 'UAT_PENDING';
  planId: string;
  decisionBasis: string;
  note: string;
};

export type Hq3dSnapshot = {
  generatedAt: string;
  buildings: Array<{
    id: string;
    name: string;
    aspect: number;
    aspAll: number[];
    floors: Array<{
      floorNo: number;
      tag: string;
      sheet: string;
      areaTotal: number | null;
      rooms: Array<{
        uid: string;
        no: string;
        cat: string;
        label: string;
        dept: string;
        person: string;
        notes: string;
        lines: string[];
        nx: number;
        nz: number;
        nw: number;
        nd: number;
        frac: number;
      }>;
    }>;
  }>;
  profiles: Record<string, Hq3dRoomProfile>;
  maintenance: Record<string, { records: Hq3dMaintenanceRecord[] }>;
  resourceMappings: Record<string, Hq3dResourceMapping>;
  dispositions: Record<string, Hq3dRoomDisposition>;
  floorAreas: Record<string, number>;
  options: {
    maintenanceTypes: string[];
    maintainableCategories: string[];
  };
};

const floorAreaKey = (buildingId: string, floorTag: string) => `${buildingId}#${floorTag}`;

export const getHq3dSnapshot = async (): Promise<Hq3dSnapshot> => {
  const pool = getDbPool();
  const [buildingRows] = await pool.query<any[]>(
    'SELECT id, name, aspect, asp_all FROM hq3d_building ORDER BY sort_order, id'
  );
  const [floorRows] = await pool.query<any[]>(
    'SELECT building_id, floor_no, floor_tag, sheet_name, area_total FROM hq3d_floor ORDER BY building_id, floor_no'
  );
  const [roomRows] = await pool.query<any[]>(
    `SELECT uid, building_id, floor_no, room_no, category, label, dept, person, notes, label_lines, nx, nz, nw, nd, frac
       FROM hq3d_room WHERE is_active = 1 ORDER BY building_id, floor_no, sort_index`
  );
  const [profileRows] = await pool.query<any[]>(
    'SELECT room_uid, label, person, dept, notes, category, area_sqm, history, updated_by, updated_at FROM hq3d_room_profile'
  );
  const [maintenanceRows] = await pool.query<any[]>(
    `SELECT id, room_uid, type, title, note, reporter, status, created_at, updated_at
       FROM hq3d_room_maintenance ORDER BY created_at DESC`
  );
  const [mappingRows] = await pool.query<any[]>(
    `SELECT mapping.room_uid, mapping.resource_id, mapping.plan_id, mapping.decision_ref, mapping.decision_basis, mapping.note
       FROM hq3d_room_resource mapping
       JOIN hq3d_room room ON room.uid = mapping.room_uid AND room.is_active = 1
       ORDER BY mapping.room_uid`
  );
  const [dispositionRows] = await pool.query<any[]>(
    `SELECT item.room_uid, item.disposition, item.review_status, item.plan_id, item.decision_basis, item.note
       FROM hq3d_room_disposition item
       JOIN hq3d_room room ON room.uid = item.room_uid AND room.is_active = 1
       ORDER BY item.room_uid`
  );

  const floorsByBuilding = new Map<string, Hq3dSnapshot['buildings'][number]['floors']>();
  const roomsByFloor = new Map<string, Hq3dSnapshot['buildings'][number]['floors'][number]['rooms']>();
  const floorAreas: Record<string, number> = {};

  for (const row of floorRows) {
    const key = `${row.building_id}#${row.floor_no}`;
    const floor = {
      floorNo: Number(row.floor_no),
      tag: String(row.floor_tag),
      sheet: String(row.sheet_name),
      areaTotal: asNumber(row.area_total),
      rooms: []
    };
    roomsByFloor.set(key, floor.rooms);
    if (!floorsByBuilding.has(row.building_id)) floorsByBuilding.set(row.building_id, []);
    floorsByBuilding.get(row.building_id)!.push(floor);
    if (floor.areaTotal !== null) floorAreas[floorAreaKey(row.building_id, floor.tag)] = floor.areaTotal;
  }

  for (const row of roomRows) {
    const rooms = roomsByFloor.get(`${row.building_id}#${row.floor_no}`);
    if (!rooms) continue;
    rooms.push({
      uid: String(row.uid),
      no: String(row.room_no || ''),
      cat: String(row.category),
      label: String(row.label),
      dept: String(row.dept || ''),
      person: String(row.person || ''),
      notes: String(row.notes || ''),
      lines: parseJson<string[]>(row.label_lines, []),
      nx: Number(row.nx),
      nz: Number(row.nz),
      nw: Number(row.nw),
      nd: Number(row.nd),
      frac: Number(row.frac || 0)
    });
  }

  const profiles: Record<string, Hq3dRoomProfile> = {};
  for (const row of profileRows) {
    profiles[String(row.room_uid)] = {
      uid: String(row.room_uid),
      label: row.label ?? undefined,
      person: row.person ?? undefined,
      dept: row.dept ?? undefined,
      notes: row.notes ?? undefined,
      category: row.category ?? undefined,
      areaSqm: asNumber(row.area_sqm) ?? undefined,
      history: parseJson(row.history, []),
      updatedBy: row.updated_by ?? undefined,
      updatedAt: asIso(row.updated_at) ?? undefined
    };
  }

  const maintenance: Record<string, { records: Hq3dMaintenanceRecord[] }> = {};
  for (const row of maintenanceRows) {
    const roomUid = String(row.room_uid);
    if (!maintenance[roomUid]) maintenance[roomUid] = { records: [] };
    maintenance[roomUid].records.push({
      id: String(row.id),
      roomUid,
      type: String(row.type),
      title: String(row.title),
      note: String(row.note || ''),
      reporter: String(row.reporter || ''),
      status: row.status as MaintenanceStatus,
      createdAt: asIso(row.created_at)!,
      updatedAt: asIso(row.updated_at)!
    });
  }

  const resourceMappings: Record<string, Hq3dResourceMapping> = {};
  for (const row of mappingRows) {
    resourceMappings[String(row.room_uid)] = {
      roomUid: String(row.room_uid),
      resourceId: String(row.resource_id),
      planId: String(row.plan_id),
      decisionRef: String(row.decision_ref),
      decisionBasis: String(row.decision_basis),
      note: String(row.note || '')
    };
  }
  const dispositions: Record<string, Hq3dRoomDisposition> = {};
  for (const row of dispositionRows) {
    dispositions[String(row.room_uid)] = {
      roomUid: String(row.room_uid),
      disposition: row.disposition,
      reviewStatus: row.review_status,
      planId: String(row.plan_id),
      decisionBasis: String(row.decision_basis),
      note: String(row.note || '')
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    buildings: buildingRows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      aspect: Number(row.aspect),
      aspAll: parseJson<number[]>(row.asp_all, []),
      floors: floorsByBuilding.get(String(row.id)) || []
    })),
    profiles,
    maintenance,
    resourceMappings,
    dispositions,
    floorAreas,
    options: {
      maintenanceTypes: MAINTENANCE_TYPES,
      maintainableCategories: MAINTAINABLE_CATEGORIES
    }
  };
};

const assertRoomExists = async (conn: PoolConnection, uid: string) => {
  const [rows] = await conn.query<any[]>('SELECT uid, category FROM hq3d_room WHERE uid = ? AND is_active = 1', [uid]);
  if (!rows[0]) throw new DbError('ROOM_NOT_FOUND', 404);
  return { uid: String(rows[0].uid), category: String(rows[0].category) };
};

const withTransaction = async <T>(runner: (conn: PoolConnection) => Promise<T>): Promise<T> => {
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await runner(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/*
 * 保存房间资料。只写「被改过的字段」：
 * 传 null / '' 表示清除该覆盖（回到 Excel 原值），不是把字段改成空字符串。
 * 每次实际变化都追加一条历史，历史里留字段中文名，界面直接能显示。
 */
export const saveHq3dRoomProfile = async (
  actor: User,
  uid: string,
  patch: Record<string, unknown>
): Promise<Hq3dRoomProfile> => {
  const roomUid = clampText(uid, 255);
  if (!roomUid) throw new DbError('ROOM_UID_REQUIRED', 400);

  return withTransaction(async conn => {
    const room = await assertRoomExists(conn, roomUid);

    const [existingRows] = await conn.query<any[]>(
      'SELECT label, person, dept, notes, category, area_sqm, history FROM hq3d_room_profile WHERE room_uid = ?',
      [roomUid]
    );
    const existing = existingRows[0] || null;
    const history = parseJson<any[]>(existing?.history, []);

    const next: Record<string, string | number | null> = {
      label: existing?.label ?? null,
      person: existing?.person ?? null,
      dept: existing?.dept ?? null,
      notes: existing?.notes ?? null,
      category: existing?.category ?? null,
      area_sqm: existing?.area_sqm === null || existing?.area_sqm === undefined ? null : Number(existing.area_sqm)
    };

    const labelOf = (value: unknown, previous: unknown) => {
      const before = previous === null || previous === undefined ? '' : String(previous);
      const after = value === null || value === undefined ? '' : String(value);
      return { before, after };
    };

    for (const field of EDITABLE_TEXT_FIELDS) {
      if (!(field in patch)) continue;
      const column = field === 'category' ? 'category' : field;
      const nextValue = clampText(patch[field], field === 'notes' ? 512 : 255);
      const { before, after } = labelOf(nextValue, next[column]);
      if (before === after) continue;
      next[column] = nextValue;
      history.unshift({
        field: field === 'category' ? 'cat' : field,
        fieldLabel: FIELD_LABEL[field === 'category' ? 'category' : field] || field,
        from: before,
        to: after,
        by: actor.name || actor.id,
        at: new Date().toISOString()
      });
    }

    if ('areaSqm' in patch) {
      const raw = patch.areaSqm;
      let area: number | null = null;
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) throw new DbError('INVALID_AREA', 400);
        area = Math.round(parsed * 100) / 100;
      }
      const before = next.area_sqm === null ? '' : String(next.area_sqm);
      const after = area === null ? '' : String(area);
      if (before !== after) {
        next.area_sqm = area;
        history.unshift({
          field: 'area',
          fieldLabel: FIELD_LABEL.areaSqm,
          from: before,
          to: after,
          by: actor.name || actor.id,
          at: new Date().toISOString()
        });
      }
    }

    if (history.length > 200) history.length = 200;

    await conn.query(
      `INSERT INTO hq3d_room_profile (room_uid, label, person, dept, notes, category, area_sqm, history, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label), person = VALUES(person), dept = VALUES(dept), notes = VALUES(notes),
         category = VALUES(category), area_sqm = VALUES(area_sqm), history = VALUES(history),
         updated_by = VALUES(updated_by)`,
      [
        roomUid,
        next.label,
        next.person,
        next.dept,
        next.notes,
        next.category,
        next.area_sqm,
        JSON.stringify(history),
        actor.id
      ]
    );

    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_ROOM_PROFILE_SAVE',
      entityType: 'HQ3D_ROOM',
      entityId: roomUid,
      details: { fields: Object.keys(patch), category: room.category }
    });

    return {
      uid: roomUid,
      label: (next.label as string | null) ?? undefined,
      person: (next.person as string | null) ?? undefined,
      dept: (next.dept as string | null) ?? undefined,
      notes: (next.notes as string | null) ?? undefined,
      category: (next.category as string | null) ?? undefined,
      areaSqm: (next.area_sqm as number | null) ?? undefined,
      history,
      updatedBy: actor.id,
      updatedAt: new Date().toISOString()
    };
  });
};

export const resetHq3dRoomProfile = async (actor: User, uid: string): Promise<void> => {
  const roomUid = clampText(uid, 255);
  if (!roomUid) throw new DbError('ROOM_UID_REQUIRED', 400);
  await withTransaction(async conn => {
    await assertRoomExists(conn, roomUid);
    await conn.query('DELETE FROM hq3d_room_profile WHERE room_uid = ?', [roomUid]);
    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_ROOM_PROFILE_RESET',
      entityType: 'HQ3D_ROOM',
      entityId: roomUid
    });
  });
};

export const addHq3dMaintenance = async (
  actor: User,
  uid: string,
  input: Record<string, unknown>
): Promise<Hq3dMaintenanceRecord> => {
  const roomUid = clampText(uid, 255);
  if (!roomUid) throw new DbError('ROOM_UID_REQUIRED', 400);
  const type = clampText(input?.type, 32) || '其他';
  if (!MAINTENANCE_TYPES.includes(type)) throw new DbError('INVALID_MAINTENANCE_TYPE', 400, { allowed: MAINTENANCE_TYPES });
  const title = clampText(input?.title, 255) || `${type}报修`;
  const note = clampText(input?.note, 2000) || '';
  const reporter = clampText(input?.reporter, 128) || actor.name || actor.id;

  return withTransaction(async conn => {
    const room = await assertRoomExists(conn, roomUid);
    // 只给办公室与会议室报修：楼梯、电梯、卫生间不归房间维护流程管
    if (!MAINTAINABLE_CATEGORIES.includes(room.category)) {
      throw new DbError('ROOM_NOT_MAINTAINABLE', 400, { category: room.category });
    }
    const id = `m${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const now = new Date();
    await conn.query(
      `INSERT INTO hq3d_room_maintenance (id, room_uid, type, title, note, reporter, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [id, roomUid, type, title, note, reporter, now, now]
    );
    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_MAINTENANCE_CREATE',
      entityType: 'HQ3D_MAINTENANCE',
      entityId: id,
      details: { roomUid, type, title }
    });
    return {
      id,
      roomUid,
      type,
      title,
      note,
      reporter,
      status: 'open' as MaintenanceStatus,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  });
};

export const updateHq3dMaintenanceStatus = async (
  actor: User,
  recordId: string,
  status: unknown
): Promise<Hq3dMaintenanceRecord> => {
  const id = clampText(recordId, 64);
  if (!id) throw new DbError('RECORD_ID_REQUIRED', 400);
  const nextStatus = String(status || '');
  if (!MAINTENANCE_STATUSES.includes(nextStatus as MaintenanceStatus)) {
    throw new DbError('INVALID_MAINTENANCE_STATUS', 400, { allowed: MAINTENANCE_STATUSES });
  }

  return withTransaction(async conn => {
    const [rows] = await conn.query<any[]>(
      'SELECT id, room_uid, type, title, note, reporter, status, created_at FROM hq3d_room_maintenance WHERE id = ?',
      [id]
    );
    const row = rows[0];
    if (!row) throw new DbError('MAINTENANCE_NOT_FOUND', 404);
    const now = new Date();
    await conn.query('UPDATE hq3d_room_maintenance SET status = ?, updated_at = ? WHERE id = ?', [nextStatus, now, id]);
    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_MAINTENANCE_STATUS',
      entityType: 'HQ3D_MAINTENANCE',
      entityId: id,
      details: { from: row.status, to: nextStatus, roomUid: row.room_uid }
    });
    return {
      id: String(row.id),
      roomUid: String(row.room_uid),
      type: String(row.type),
      title: String(row.title),
      note: String(row.note || ''),
      reporter: String(row.reporter || ''),
      status: nextStatus as MaintenanceStatus,
      createdAt: asIso(row.created_at)!,
      updatedAt: now.toISOString()
    };
  });
};

export const deleteHq3dMaintenance = async (actor: User, recordId: string): Promise<void> => {
  const id = clampText(recordId, 64);
  if (!id) throw new DbError('RECORD_ID_REQUIRED', 400);
  await withTransaction(async conn => {
    const [rows] = await conn.query<any[]>('SELECT room_uid FROM hq3d_room_maintenance WHERE id = ?', [id]);
    if (!rows[0]) throw new DbError('MAINTENANCE_NOT_FOUND', 404);
    await conn.query('DELETE FROM hq3d_room_maintenance WHERE id = ?', [id]);
    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_MAINTENANCE_DELETE',
      entityType: 'HQ3D_MAINTENANCE',
      entityId: id,
      details: { roomUid: rows[0].room_uid }
    });
  });
};

export const setHq3dFloorArea = async (
  actor: User,
  buildingId: string,
  floorTag: string,
  areaTotal: unknown
): Promise<number | null> => {
  const building = clampText(buildingId, 32);
  const tag = clampText(floorTag, 16);
  if (!building || !tag) throw new DbError('FLOOR_REQUIRED', 400);

  let area: number | null = null;
  if (areaTotal !== null && areaTotal !== undefined && String(areaTotal).trim() !== '') {
    const parsed = Number(areaTotal);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000000) throw new DbError('INVALID_AREA', 400);
    area = Math.round(parsed * 100) / 100;
  }

  return withTransaction(async conn => {
    const [rows] = await conn.query<any[]>(
      'SELECT floor_no FROM hq3d_floor WHERE building_id = ? AND floor_tag = ?',
      [building, tag]
    );
    if (!rows[0]) throw new DbError('FLOOR_NOT_FOUND', 404);
    await conn.query('UPDATE hq3d_floor SET area_total = ?, updated_by = ? WHERE building_id = ? AND floor_tag = ?', [
      area,
      actor.id,
      building,
      tag
    ]);
    await writeAudit(conn, {
      actorId: actor.id,
      action: 'HQ3D_FLOOR_AREA_SET',
      entityType: 'HQ3D_FLOOR',
      entityId: floorAreaKey(building, tag),
      details: { areaTotal: area }
    });
    return area;
  });
};
