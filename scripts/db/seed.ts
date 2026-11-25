import { INITIAL_RESOURCES } from '../../constants.ts';
import { applyInitialOfficeState, assertInitialStateEmpty } from '../../server/bootstrap.ts';
import { closeDbPool, mutateDb, readSnapshot } from '../../server/db.ts';

try {
  const { revision } = await readSnapshot();
  await mutateDb(db => {
    assertInitialStateEmpty(db);
    applyInitialOfficeState(db, INITIAL_RESOURCES);
  }, { expectedRevision: revision, replaceBookings: true });
  console.log('演示初始数据已写入 MySQL；新系统部署请使用 npm run db:init');
} finally {
  await closeDbPool();
}
