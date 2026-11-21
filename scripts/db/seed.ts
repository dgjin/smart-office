import { closeDbPool, mutateDb, readSnapshot } from '../../server/db.ts';
import { DEFAULT_RULE_SETTINGS, DEFAULT_WORKFLOW, INITIAL_BOOKINGS, INITIAL_DEPARTMENTS, INITIAL_RESOURCES, INITIAL_ROLES, INITIAL_USERS } from '../../constants.ts';
import { ensureApprovalPolicy } from '../../utils/approvalPolicy.ts';
import { ensureServiceDomain } from '../../server/serviceDomain.ts';

try {
  const { db, revision } = await readSnapshot();
  if ((db.users || []).length || (db.resources || []).length || (db.bookings || []).length || (db.roles || []).length) {
    throw new Error('只允许在空业务数据库中执行初始化');
  }
  await mutateDb(db => {
    db.roles = INITIAL_ROLES;
    db.users = INITIAL_USERS;
    db.resources = INITIAL_RESOURCES;
    db.bookings = INITIAL_BOOKINGS;
    db.departments = INITIAL_DEPARTMENTS;
    db.workflow = DEFAULT_WORKFLOW;
    db.workflowVersions = [{ version: 1, nodes: DEFAULT_WORKFLOW, createdAt: new Date().toISOString(), createdBy: 'system' }];
    db.approvalDelegates = [];
    db.workOrders = [];
    db.ruleVersions = [{ version: 1, settings: DEFAULT_RULE_SETTINGS, createdAt: new Date().toISOString(), createdBy: 'system' }];
    db.resourceImportBatches = [];
    db.confidentialWhitelist = [];
    db.confidentialityAuthorizations = [];
    db.confidentialAccessGrants = [];
    db.checkInEvents = [];
    db.usageFacts = [];
    db.usageAppeals = [];
    db.devices = [];
    db.exceptionActions = [];
    ensureApprovalPolicy(db);
    ensureServiceDomain(db);
  }, { expectedRevision: revision, replaceBookings: true });
  console.log('受控初始数据已写入 MySQL');
} finally {
  await closeDbPool();
}
