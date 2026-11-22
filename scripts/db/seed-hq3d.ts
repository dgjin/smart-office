import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDbPool, getDbPool } from '../../server/db.ts';
import { seedHq3dLayout, type Hq3dSeedData } from '../../server/hq3dLayout.ts';

const seedPath = path.resolve('server/data/hq3d-floorplan.json');
const data = JSON.parse(await readFile(seedPath, 'utf8')) as Hq3dSeedData;
const conn = await getDbPool().getConnection();

try {
  const result = await seedHq3dLayout(conn, data);
  console.log(`楼层分布数据已写入 MySQL：楼栋 ${result.buildings} · 楼层 ${result.floors} · 房间 ${result.rooms} · 本轮停用 ${result.retired}`);
} finally {
  conn.release();
  await closeDbPool();
}
