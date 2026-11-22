import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDbPool } from '../../server/db.ts';
import { applyHq3dSyncPlan, type Hq3dSyncPlan } from '../../server/hq3dSync.ts';

const actorId = process.env.HQ3D_SYNC_ACTOR_ID || '1';
const planPath = path.resolve('server/data/hq3d-confirmation-20261122.json');

try {
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as Hq3dSyncPlan;
  const result = await applyHq3dSyncPlan(plan, actorId);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} finally {
  await closeDbPool();
}
