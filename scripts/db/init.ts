import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RULE_SETTINGS } from '../../constants.ts';
import { applyInitialOfficeState, assertInitialStateEmpty } from '../../server/bootstrap.ts';
import { closeDbPool, mutateDb, normalizeResource } from '../../server/db.ts';
import { writeHq3dLayout, type Hq3dSeedData } from '../../server/hq3dLayout.ts';
import type { Resource } from '../../types.ts';

const [meetingRoomData, hq3dData] = await Promise.all([
  readFile(path.resolve('server/data/meeting-rooms.json'), 'utf8').then(JSON.parse) as Promise<Resource[]>,
  readFile(path.resolve('server/data/hq3d-floorplan.json'), 'utf8').then(JSON.parse) as Promise<Hq3dSeedData>
]);
const meetingRooms = meetingRoomData.map(resource => normalizeResource(resource, undefined, DEFAULT_RULE_SETTINGS));

try {
  const result = await mutateDb(async (db, { connection }) => {
    assertInitialStateEmpty(db);
    const [rows] = await connection.query<any[]>(`SELECT
      (SELECT COUNT(*) FROM hq3d_building)
      + (SELECT COUNT(*) FROM hq3d_floor)
      + (SELECT COUNT(*) FROM hq3d_room)
      + (SELECT COUNT(*) FROM hq3d_room_profile)
      + (SELECT COUNT(*) FROM hq3d_room_maintenance)
      + (SELECT COUNT(*) FROM hq3d_room_resource)
      + (SELECT COUNT(*) FROM hq3d_room_disposition)
      + (SELECT COUNT(*) FROM resource_retirements) AS total`);
    if (Number(rows[0]?.total || 0)) throw new Error('只允许在空业务数据库中执行初始化');

    applyInitialOfficeState(db, meetingRooms);
    const hq3d = await writeHq3dLayout(connection, hq3dData);
    return { meetingRooms: meetingRooms.length, hq3d };
  }, { replaceBookings: true });
  console.log(`系统基础数据已写入 MySQL：会议室 ${result.meetingRooms} · 楼栋 ${result.hq3d.buildings} · 楼层 ${result.hq3d.floors} · 空间 ${result.hq3d.rooms}`);
} finally {
  await closeDbPool();
}
