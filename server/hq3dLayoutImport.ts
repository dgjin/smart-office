import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getDbPool } from './db.ts';
import { DbError } from './errors.ts';
import { writeAudit } from './audit.ts';
import { upsertHq3dRoom, type Hq3dSeedRoom } from './hq3dLayout.ts';

export type Hq3dLayoutScope = {
  kind: 'BUILDING' | 'FLOOR';
  buildingId: string;
  floorNo?: number;
};

export type Hq3dLayoutFloor = {
  floorNo: number;
  tag: string;
  sheet: string;
  rooms: Hq3dSeedRoom[];
};

export type Hq3dLayoutDocument = {
  format: 'smart-office.hq3d-layout';
  schemaVersion: 1;
  scope: Hq3dLayoutScope;
  building: {
    id: string;
    name: string;
    aspect: number;
    aspAll: number[];
    floors: Hq3dLayoutFloor[];
  };
};

type CurrentRoom = Hq3dSeedRoom & {
  floorNo: number;
  sortIndex: number;
  isActive: boolean;
};

type CurrentLayout = {
  scope: Hq3dLayoutScope;
  building: {
    id: string;
    name: string;
    aspect: number;
    aspAll: number[];
  };
  floors: Array<{
    floorNo: number;
    tag: string;
    sheet: string;
    rooms: CurrentRoom[];
  }>;
};

export type Hq3dLayoutIssue = {
  code: string;
  message: string;
  uid?: string;
};

export type Hq3dLayoutReport = {
  ok: boolean;
  hasChanges: boolean;
  baselineHash: string;
  scope: Hq3dLayoutScope;
  buildingName: string;
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    restored: number;
    retired: number;
  };
  metadataChanged: boolean;
  changes: Array<{
    action: 'CREATE' | 'UPDATE' | 'RESTORE' | 'RETIRE';
    uid: string;
    label: string;
    floorNo: number;
  }>;
  errors: Hq3dLayoutIssue[];
};

const layoutError = (code: string, message: string, status = 400, details: Record<string, unknown> = {}) =>
  new DbError(code, status, { detail: message, ...details });

const invalidLayout = (message: string) => layoutError('INVALID_HQ3D_LAYOUT', message);
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const textField = (value: unknown, field: string, max: number, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw invalidLayout(`${field}不能为空。`);
    return '';
  }
  if (typeof value !== 'string') throw invalidLayout(`${field}必须是文本。`);
  const text = value.trim();
  if (required && !text) throw invalidLayout(`${field}不能为空。`);
  if (text.length > max) throw invalidLayout(`${field}不能超过${max}个字符。`);
  return text;
};

const numberField = (value: unknown, field: string, min: number, max: number, exclusiveMin = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    throw invalidLayout(`${field}必须是${exclusiveMin ? '大于' : '不小于'}${min}且不大于${max}的有效数字。`);
  }
  return value;
};

const parseScope = (value: unknown): Hq3dLayoutScope => {
  if (!isObject(value)) throw invalidLayout('缺少导入范围。');
  const kind = value.kind;
  if (kind !== 'BUILDING' && kind !== 'FLOOR') throw invalidLayout('导入范围仅支持整栋或单层。');
  const buildingId = textField(value.buildingId, '楼栋ID', 32, true);
  if (kind === 'BUILDING') return { kind, buildingId };
  if (!Number.isSafeInteger(value.floorNo) || Number(value.floorNo) < 1 || Number(value.floorNo) > 65535) {
    throw invalidLayout('单层导入必须提供有效楼层号。');
  }
  return { kind, buildingId, floorNo: Number(value.floorNo) };
};

const parseRoom = (value: unknown, path: string): Hq3dSeedRoom => {
  if (!isObject(value)) throw invalidLayout(`${path}必须是对象。`);
  const uid = textField(value.uid, `${path}.uid`, 255, true);
  if (uid !== value.uid) throw invalidLayout(`${path}.uid首尾不能包含空格。`);
  const label = textField(value.label, `${path}.label`, 255, true);
  const lines = value.lines === undefined
    ? [label]
    : Array.isArray(value.lines)
      ? value.lines.map((line, index) => textField(line, `${path}.lines[${index}]`, 255))
      : (() => { throw invalidLayout(`${path}.lines必须是文本数组。`); })();
  const room = {
    uid,
    no: textField(value.no, `${path}.no`, 64),
    cat: textField(value.cat, `${path}.cat`, 32, true),
    label,
    dept: textField(value.dept, `${path}.dept`, 255),
    person: textField(value.person, `${path}.person`, 255),
    notes: textField(value.notes, `${path}.notes`, 512),
    lines,
    nx: numberField(value.nx, `${path}.nx`, 0, 1),
    nz: numberField(value.nz, `${path}.nz`, 0, 1),
    nw: numberField(value.nw, `${path}.nw`, 0, 1, true),
    nd: numberField(value.nd, `${path}.nd`, 0, 1, true),
    frac: value.frac === undefined ? 0 : numberField(value.frac, `${path}.frac`, 0, 1)
  };
  if (room.nx + room.nw > 1.000001 || room.nz + room.nd > 1.000001) {
    throw invalidLayout(`${path}超出了楼层归一化边界。`);
  }
  return room;
};

export const parseHq3dLayoutDocument = (value: unknown): Hq3dLayoutDocument => {
  if (!isObject(value)) throw invalidLayout('布局文件必须是JSON对象。');
  if (value.format !== 'smart-office.hq3d-layout' || value.schemaVersion !== 1) {
    throw invalidLayout('布局文件格式或版本不受支持，请从系统重新导出模板。');
  }
  const scope = parseScope(value.scope);
  if (!isObject(value.building)) throw invalidLayout('缺少楼栋布局数据。');
  const id = textField(value.building.id, '楼栋ID', 32, true);
  if (id !== scope.buildingId) throw invalidLayout('导入范围与楼栋数据不一致。');
  const aspect = numberField(value.building.aspect, '楼栋宽高比', 0, 9999.99999, true);
  if (!Array.isArray(value.building.aspAll)) throw invalidLayout('aspAll必须是数字数组。');
  const aspAll = value.building.aspAll.map((item, index) => numberField(item, `aspAll[${index}]`, 0, 9999.99999, true));
  if (!Array.isArray(value.building.floors) || !value.building.floors.length) throw invalidLayout('布局文件至少需要一个楼层。');
  if (scope.kind === 'FLOOR' && value.building.floors.length !== 1) throw invalidLayout('单层导入文件只能包含一个楼层。');
  if (scope.kind === 'BUILDING' && aspAll.length !== 0 && aspAll.length !== value.building.floors.length) {
    throw invalidLayout('aspAll必须为空，或与楼层数量一致。');
  }
  const floorNumbers = new Set<number>();
  const uids = new Set<string>();
  const floors = value.building.floors.map((floorValue, floorIndex) => {
    const path = `building.floors[${floorIndex}]`;
    if (!isObject(floorValue)) throw invalidLayout(`${path}必须是对象。`);
    const floorNo = Number(floorValue.floorNo);
    if (!Number.isSafeInteger(floorNo) || floorNo < 1 || floorNo > 65535) throw invalidLayout(`${path}.floorNo无效。`);
    if (scope.kind === 'FLOOR' && floorNo !== scope.floorNo) throw invalidLayout('导入范围与楼层数据不一致。');
    if (floorNumbers.has(floorNo)) throw invalidLayout(`楼层号重复：${floorNo}。`);
    floorNumbers.add(floorNo);
    if (!Array.isArray(floorValue.rooms)) throw invalidLayout(`${path}.rooms必须是数组。`);
    const rooms = floorValue.rooms.map((room, roomIndex) => {
      const parsed = parseRoom(room, `${path}.rooms[${roomIndex}]`);
      if (uids.has(parsed.uid)) throw invalidLayout(`3D空间UID重复：${parsed.uid}。`);
      uids.add(parsed.uid);
      return parsed;
    });
    return {
      floorNo,
      tag: textField(floorValue.tag, `${path}.tag`, 16, true),
      sheet: textField(floorValue.sheet, `${path}.sheet`, 128, true),
      rooms
    };
  });
  return {
    format: 'smart-office.hq3d-layout',
    schemaVersion: 1,
    scope,
    building: {
      id,
      name: textField(value.building.name, '楼栋名称', 64, true),
      aspect,
      aspAll,
      floors
    }
  };
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

const lockClause = (lock: boolean) => lock ? ' FOR UPDATE' : '';

const loadCurrentLayout = async (conn: PoolConnection, scope: Hq3dLayoutScope, lock: boolean): Promise<CurrentLayout> => {
  const [buildingRows] = await conn.query<any[]>(
    `SELECT id, name, aspect, asp_all FROM hq3d_building WHERE id = ?${lockClause(lock)}`,
    [scope.buildingId]
  );
  if (!buildingRows.length) throw layoutError('HQ3D_LAYOUT_BUILDING_NOT_FOUND', '目标楼栋不存在，请重新导出有效模板。', 404);
  const floorParams: Array<string | number> = [scope.buildingId];
  const floorFilter = scope.kind === 'FLOOR' ? ' AND floor_no = ?' : '';
  if (scope.kind === 'FLOOR') floorParams.push(scope.floorNo!);
  const [floorRows] = await conn.query<any[]>(
    `SELECT building_id, floor_no, floor_tag, sheet_name FROM hq3d_floor
     WHERE building_id = ?${floorFilter} ORDER BY floor_no${lockClause(lock)}`,
    floorParams
  );
  if (!floorRows.length) throw layoutError('HQ3D_LAYOUT_FLOOR_NOT_FOUND', '目标楼层不存在，请重新导出有效模板。', 404);
  const roomParams: Array<string | number> = [scope.buildingId];
  const roomFilter = scope.kind === 'FLOOR' ? ' AND floor_no = ?' : '';
  if (scope.kind === 'FLOOR') roomParams.push(scope.floorNo!);
  const [roomRows] = await conn.query<any[]>(
    `SELECT uid, building_id, floor_no, room_no, category, label, dept, person, notes, label_lines,
            nx, nz, nw, nd, frac, sort_index, is_active
     FROM hq3d_room WHERE building_id = ?${roomFilter}
     ORDER BY floor_no, sort_index, uid${lockClause(lock)}`,
    roomParams
  );
  const roomsByFloor = new Map<number, CurrentRoom[]>();
  floorRows.forEach(row => roomsByFloor.set(Number(row.floor_no), []));
  for (const row of roomRows) {
    roomsByFloor.get(Number(row.floor_no))?.push({
      uid: String(row.uid),
      no: String(row.room_no || ''),
      cat: String(row.category),
      label: String(row.label),
      dept: String(row.dept || ''),
      person: String(row.person || ''),
      notes: String(row.notes || ''),
      lines: parseJson<string[]>(row.label_lines, [String(row.label)]),
      nx: Number(row.nx),
      nz: Number(row.nz),
      nw: Number(row.nw),
      nd: Number(row.nd),
      frac: Number(row.frac || 0),
      floorNo: Number(row.floor_no),
      sortIndex: Number(row.sort_index),
      isActive: Boolean(row.is_active)
    });
  }
  const building = buildingRows[0];
  return {
    scope,
    building: {
      id: String(building.id),
      name: String(building.name),
      aspect: Number(building.aspect),
      aspAll: parseJson<number[]>(building.asp_all, [])
    },
    floors: floorRows.map(row => ({
      floorNo: Number(row.floor_no),
      tag: String(row.floor_tag),
      sheet: String(row.sheet_name),
      rooms: roomsByFloor.get(Number(row.floor_no)) || []
    }))
  };
};

const baselineHash = (current: CurrentLayout) => crypto.createHash('sha256').update(JSON.stringify({
  scope: current.scope,
  building: current.building,
  floors: current.floors
})).digest('hex');

export const exportHq3dLayout = async (scopeValue: unknown): Promise<Hq3dLayoutDocument> => {
  const scope = parseScope(scopeValue);
  const conn = await getDbPool().getConnection();
  try {
    const current = await loadCurrentLayout(conn, scope, false);
    return {
      format: 'smart-office.hq3d-layout',
      schemaVersion: 1,
      scope,
      building: {
        ...current.building,
        floors: current.floors.map(floor => ({
          floorNo: floor.floorNo,
          tag: floor.tag,
          sheet: floor.sheet,
          rooms: floor.rooms.filter(room => room.isActive).map(room => ({
            uid: room.uid,
            no: room.no,
            cat: room.cat,
            label: room.label,
            dept: room.dept,
            person: room.person,
            notes: room.notes,
            lines: room.lines,
            nx: room.nx,
            nz: room.nz,
            nw: room.nw,
            nd: room.nd,
            frac: room.frac
          }))
        }))
      }
    };
  } finally {
    conn.release();
  }
};

const sameRoom = (room: Hq3dSeedRoom & { floorNo: number }, current: CurrentRoom, sortIndex: number) =>
  room.floorNo === current.floorNo && room.uid === current.uid && (room.no || '') === current.no && room.cat === current.cat &&
  room.label === current.label && (room.dept || '') === current.dept && (room.person || '') === current.person &&
  (room.notes || '') === current.notes && JSON.stringify(room.lines || [room.label]) === JSON.stringify(current.lines) &&
  room.nx === current.nx && room.nz === current.nz && room.nw === current.nw && room.nd === current.nd &&
  (room.frac ?? 0) === current.frac && sortIndex === current.sortIndex;

const buildReport = async (conn: PoolConnection, document: Hq3dLayoutDocument, current: CurrentLayout, lock: boolean): Promise<Hq3dLayoutReport> => {
  const errors: Hq3dLayoutIssue[] = [];
  const currentFloorNumbers = new Set(current.floors.map(floor => floor.floorNo));
  const incomingFloorNumbers = new Set(document.building.floors.map(floor => floor.floorNo));
  if (document.scope.kind === 'BUILDING') {
    for (const floorNo of currentFloorNumbers) {
      if (!incomingFloorNumbers.has(floorNo)) errors.push({ code: 'HQ3D_LAYOUT_FLOOR_SET_CHANGED', message: `整栋导入不能省略现有楼层 ${floorNo}F。` });
    }
    for (const floorNo of incomingFloorNumbers) {
      if (!currentFloorNumbers.has(floorNo)) errors.push({ code: 'HQ3D_LAYOUT_FLOOR_SET_CHANGED', message: `整栋导入不能新增楼层 ${floorNo}F，请先完成楼层主数据扩容。` });
    }
  } else if (
    document.building.name !== current.building.name || document.building.aspect !== current.building.aspect ||
    JSON.stringify(document.building.aspAll) !== JSON.stringify(current.building.aspAll)
  ) {
    errors.push({ code: 'HQ3D_LAYOUT_FLOOR_SCOPE_METADATA', message: '单层导入不能修改楼栋名称、宽高比或全楼楼层比例，请改用整栋导入。' });
  }

  const incomingRooms = document.building.floors.flatMap(floor => floor.rooms.map((room, sortIndex) => ({ room, floorNo: floor.floorNo, sortIndex })));
  const incomingUids = incomingRooms.map(item => item.room.uid);
  const outsideUids = new Set<string>();
  if (incomingUids.length) {
    const [outsideRows] = await conn.query<any[]>(
      `SELECT uid, building_id, floor_no FROM hq3d_room
       WHERE uid IN (${incomingUids.map(() => '?').join(',')})
         AND (building_id <> ?${document.scope.kind === 'FLOOR' ? ' OR floor_no <> ?' : ''})${lockClause(lock)}`,
      document.scope.kind === 'FLOOR' ? [...incomingUids, document.scope.buildingId, document.scope.floorNo!] : [...incomingUids, document.scope.buildingId]
    );
    for (const row of outsideRows) {
      outsideUids.add(String(row.uid));
      errors.push({
        code: 'HQ3D_LAYOUT_UID_OUTSIDE_SCOPE',
        uid: String(row.uid),
        message: `房间 ${row.uid} 已属于 ${row.building_id} ${row.floor_no}F，不能通过本次导入移动。`
      });
    }
  }

  const currentRooms = current.floors.flatMap(floor => floor.rooms);
  const currentByUid = new Map(currentRooms.map(room => [room.uid, room]));
  const currentActiveOrder = new Map<string, number>();
  current.floors.forEach(floor => floor.rooms.filter(room => room.isActive).forEach((room, index) => {
    currentActiveOrder.set(room.uid, index);
  }));
  const counts = { created: 0, updated: 0, unchanged: 0, restored: 0, retired: 0 };
  const changes: Hq3dLayoutReport['changes'] = [];
  for (const item of incomingRooms) {
    if (outsideUids.has(item.room.uid)) continue;
    const existing = currentByUid.get(item.room.uid);
    if (!existing) {
      counts.created += 1;
      changes.push({ action: 'CREATE', uid: item.room.uid, label: item.room.label, floorNo: item.floorNo });
    } else if (!existing.isActive) {
      counts.restored += 1;
      changes.push({ action: 'RESTORE', uid: item.room.uid, label: item.room.label, floorNo: item.floorNo });
    } else if (sameRoom({ ...item.room, floorNo: item.floorNo }, existing, currentActiveOrder.get(item.room.uid)!)) {
      counts.unchanged += 1;
    } else {
      counts.updated += 1;
      changes.push({ action: 'UPDATE', uid: item.room.uid, label: item.room.label, floorNo: item.floorNo });
    }
  }

  const incomingUidSet = new Set(incomingUids);
  const omitted = currentRooms.filter(room => room.isActive && !incomingUidSet.has(room.uid));
  if (omitted.length) {
    const [mappingRows] = await conn.query<any[]>(
      `SELECT room_uid, resource_id FROM hq3d_room_resource
       WHERE room_uid IN (${omitted.map(() => '?').join(',')})${lockClause(lock)}`,
      omitted.map(room => room.uid)
    );
    const mapped = new Set(mappingRows.map(row => String(row.room_uid)));
    for (const room of omitted) {
      if (mapped.has(room.uid)) {
        errors.push({
          code: 'HQ3D_LAYOUT_MAPPED_ROOM_RETIREMENT',
          uid: room.uid,
          message: `房间 ${room.label}（${room.uid}）仍绑定预约资源，不能通过省略房间停用；请先完成资源映射或退役处理。`
        });
        continue;
      }
      counts.retired += 1;
      changes.push({ action: 'RETIRE', uid: room.uid, label: room.label, floorNo: room.floorNo });
    }
  }

  const currentFloors = new Map(current.floors.map(floor => [floor.floorNo, floor]));
  let metadataChanged = document.scope.kind === 'BUILDING' && (
    document.building.name !== current.building.name || document.building.aspect !== current.building.aspect ||
    JSON.stringify(document.building.aspAll) !== JSON.stringify(current.building.aspAll)
  );
  for (const floor of document.building.floors) {
    const existing = currentFloors.get(floor.floorNo);
    if (existing && (floor.tag !== existing.tag || floor.sheet !== existing.sheet)) metadataChanged = true;
  }
  const hasChanges = metadataChanged || Object.entries(counts).some(([key, value]) => key !== 'unchanged' && value > 0);
  return {
    ok: errors.length === 0,
    hasChanges,
    baselineHash: baselineHash(current),
    scope: current.scope,
    buildingName: current.building.name,
    counts,
    metadataChanged,
    changes,
    errors
  };
};

export const preflightHq3dLayoutImport = async (value: unknown): Promise<Hq3dLayoutReport> => {
  const document = parseHq3dLayoutDocument(value);
  const conn = await getDbPool().getConnection();
  try {
    const current = await loadCurrentLayout(conn, document.scope, false);
    return await buildReport(conn, document, current, false);
  } finally {
    conn.release();
  }
};

export const importHq3dLayout = async (actorId: string, value: unknown, expectedBaseline: unknown): Promise<Hq3dLayoutReport> => {
  const document = parseHq3dLayoutDocument(value);
  if (typeof expectedBaseline !== 'string' || !/^[a-f0-9]{64}$/.test(expectedBaseline)) {
    throw layoutError('HQ3D_LAYOUT_PREFLIGHT_REQUIRED', '请先完成布局预检，再确认导入。');
  }
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const current = await loadCurrentLayout(conn, document.scope, true);
    if (baselineHash(current) !== expectedBaseline) {
      throw layoutError('HQ3D_LAYOUT_BASELINE_CHANGED', '目标布局在预检后已发生变化，请重新导出或预检。', 409);
    }
    const report = await buildReport(conn, document, current, true);
    if (!report.ok) {
      const first = report.errors[0];
      throw layoutError(first.code, first.message, 400, { errors: report.errors });
    }
    if (!report.hasChanges) throw layoutError('HQ3D_LAYOUT_IMPORT_NO_CHANGES', '文件内容与当前布局一致，无需导入。', 409);

    if (document.scope.kind === 'BUILDING') {
      await conn.query(
        'UPDATE hq3d_building SET name = ?, aspect = ?, asp_all = ? WHERE id = ?',
        [document.building.name, document.building.aspect, JSON.stringify(document.building.aspAll), document.building.id]
      );
    }
    for (const floor of document.building.floors) {
      await conn.query(
        'UPDATE hq3d_floor SET floor_tag = ?, sheet_name = ? WHERE building_id = ? AND floor_no = ?',
        [floor.tag, floor.sheet, document.building.id, floor.floorNo]
      );
      for (const [roomIndex, room] of floor.rooms.entries()) {
        await upsertHq3dRoom(conn, document.building.id, floor.floorNo, room, roomIndex);
      }
    }
    for (const change of report.changes.filter(item => item.action === 'RETIRE')) {
      await conn.query(
        `UPDATE hq3d_room SET is_active = 0, retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP(3))
         WHERE uid = ? AND building_id = ? AND floor_no = ? AND is_active = 1`,
        [change.uid, document.building.id, change.floorNo]
      );
    }
    await writeAudit(conn, {
      actorId,
      action: 'HQ3D_LAYOUT_IMPORT',
      entityType: 'HQ3D_LAYOUT',
      entityId: document.scope.kind === 'FLOOR' ? `${document.scope.buildingId}#${document.scope.floorNo}F` : document.scope.buildingId,
      details: {
        scope: document.scope,
        baselineHash: report.baselineHash,
        counts: report.counts,
        metadataChanged: report.metadataChanged
      }
    });
    await conn.commit();
    return report;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};
