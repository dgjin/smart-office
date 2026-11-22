import { readFile, writeFile } from 'node:fs/promises';
import { closeDbPool, getDbPool } from '../server/db.ts';

const layoutPath = 'server/data/hq3d-floorplan.json';
const data = JSON.parse(await readFile(layoutPath, 'utf8'));
const rooms: Array<{ room: any; uid: string }> = [];

for (const building of data.buildings) {
  for (const [floorIndex, floor] of building.floors.entries()) {
    const floorTag = `${floorIndex + 1}F`;
    const sequences = new Map<string, number>();
    for (const room of floor.rooms) {
      const base = [building.id, floorTag, room.no || '_', String(room.label).replace(/\s+/g, '')].join('#');
      const sequence = (sequences.get(base) || 0) + 1;
      sequences.set(base, sequence);
      rooms.push({ room, uid: sequence === 1 ? base : `${base}#${sequence}` });
    }
  }
}

const expected = rooms.map(item => item.uid);
if (new Set(expected).size !== expected.length) throw new Error('布局生成的UID存在重复');

try {
  const [rows] = await getDbPool().query<any[]>('SELECT uid FROM hq3d_room');
  const actual = rows.map(row => String(row.uid));
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(uid => !actualSet.has(uid));
  const extra = actual.filter(uid => !expectedSet.has(uid));
  if (missing.length || extra.length || actual.length !== expected.length) {
    throw new Error(`实库UID与布局不一致：布局 ${expected.length}，实库 ${actual.length}，实库缺少 ${missing.length}，实库额外 ${extra.length}`);
  }
  for (const { room, uid } of rooms) {
    if (room.uid && room.uid !== uid) throw new Error('布局已有UID与当前实库基线不一致');
    delete room.uid;
    room.uid = uid;
    const reordered = { uid: room.uid };
    for (const [key, value] of Object.entries(room)) {
      if (key !== 'uid') reordered[key] = value;
    }
    for (const key of Object.keys(room)) delete room[key];
    Object.assign(room, reordered);
  }
  await writeFile(layoutPath, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  console.log(`已按实库基线固化 ${expected.length} 个显式UID`);
} finally {
  await closeDbPool();
}
