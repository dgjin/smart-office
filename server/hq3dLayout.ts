import type { PoolConnection } from 'mysql2/promise';

export type Hq3dSeedRoom = {
  uid: string;
  no?: string;
  cat: string;
  label: string;
  dept?: string;
  person?: string;
  notes?: string;
  lines?: string[];
  nx: number;
  nz: number;
  nw: number;
  nd: number;
  frac?: number;
};

export type Hq3dSeedFloor = { sheet: string; rooms: Hq3dSeedRoom[] };
export type Hq3dSeedBuilding = { id: string; name: string; aspect: number; aspAll: number[]; floors: Hq3dSeedFloor[] };
export type Hq3dSeedData = { buildings: Hq3dSeedBuilding[] };

const nullable = (value: unknown) => value === undefined || value === null ? null : value;

export const validateHq3dLayout = (data: Hq3dSeedData) => {
  const uids = new Set<string>();
  for (const building of data.buildings) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const uid = String(room.uid || '');
        if (!uid || uid !== uid.trim() || uid.length > 255) throw new Error(`无效3D空间UID：${uid || '(空)'}`);
        if (uids.has(uid)) throw new Error(`3D空间UID重复：${uid}`);
        uids.add(uid);
      }
    }
  }
  return uids;
};

export const upsertHq3dRoom = async (
  conn: PoolConnection,
  buildingId: string,
  floorNo: number,
  room: Hq3dSeedRoom,
  roomIndex: number
) => {
  await conn.query(
    `INSERT INTO hq3d_room
       (uid, building_id, floor_no, room_no, category, label, dept, person, notes, label_lines, nx, nz, nw, nd, frac, sort_index, is_active, retired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
     ON DUPLICATE KEY UPDATE
       building_id = VALUES(building_id), floor_no = VALUES(floor_no), room_no = VALUES(room_no),
       category = VALUES(category), label = VALUES(label), dept = VALUES(dept), person = VALUES(person),
       notes = VALUES(notes), label_lines = VALUES(label_lines), nx = VALUES(nx), nz = VALUES(nz),
       nw = VALUES(nw), nd = VALUES(nd), frac = VALUES(frac), sort_index = VALUES(sort_index),
       is_active = 1, retired_at = NULL`,
    [
      room.uid,
      buildingId,
      floorNo,
      nullable(room.no) ?? '',
      room.cat,
      room.label,
      nullable(room.dept) ?? '',
      nullable(room.person) ?? '',
      nullable(room.notes) ?? '',
      JSON.stringify(room.lines || [room.label]),
      room.nx,
      room.nz,
      room.nw,
      room.nd,
      room.frac ?? 0,
      roomIndex
    ]
  );
};

export const seedHq3dLayout = async (conn: PoolConnection, data: Hq3dSeedData) => {
  const expectedUids = validateHq3dLayout(data);
  let buildings = 0;
  let floors = 0;
  let rooms = 0;
  let retired = 0;

  await conn.beginTransaction();
  try {
    for (const [buildingIndex, building] of data.buildings.entries()) {
      await conn.query(
        `INSERT INTO hq3d_building (id, name, aspect, asp_all, sort_order) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), aspect = VALUES(aspect), asp_all = VALUES(asp_all), sort_order = VALUES(sort_order)`,
        [building.id, building.name, building.aspect, JSON.stringify(building.aspAll || []), buildingIndex]
      );
      buildings += 1;
      for (const [floorIndex, floor] of building.floors.entries()) {
        const floorNo = floorIndex + 1;
        const floorTag = `${floorNo}F`;
        await conn.query(
          `INSERT INTO hq3d_floor (building_id, floor_no, floor_tag, sheet_name) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE floor_tag = VALUES(floor_tag), sheet_name = VALUES(sheet_name)`,
          [building.id, floorNo, floorTag, floor.sheet]
        );
        floors += 1;
        for (const [roomIndex, room] of floor.rooms.entries()) {
          await upsertHq3dRoom(conn, building.id, floorNo, room, roomIndex);
          rooms += 1;
        }
      }
    }

    const uids = [...expectedUids];
    const [result] = await conn.query<any>(
      uids.length
        ? `UPDATE hq3d_room SET is_active = 0, retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP(3))
           WHERE is_active = 1 AND uid NOT IN (${uids.map(() => '?').join(',')})`
        : 'UPDATE hq3d_room SET is_active = 0, retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP(3)) WHERE is_active = 1',
      uids
    );
    retired = result.affectedRows;
    await conn.commit();
    return { buildings, floors, rooms, retired };
  } catch (error) {
    await conn.rollback();
    throw error;
  }
};
