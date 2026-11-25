import {
  DEFAULT_RULE_SETTINGS,
  DEFAULT_WORKFLOW,
  INITIAL_BOOKINGS,
  INITIAL_DEPARTMENTS,
  INITIAL_ROLES,
  INITIAL_USERS
} from '../constants.ts';
import type { Resource } from '../types.ts';
import { ensureApprovalPolicy } from '../utils/approvalPolicy.ts';
import { ensureServiceDomain } from './serviceDomain.ts';
import type { OfficeDb } from './tools.ts';

export const assertInitialStateEmpty = (db: OfficeDb) => {
  if (Object.values(db).some(value => Array.isArray(value) && value.length)) {
    throw new Error('只允许在空业务数据库中执行初始化');
  }
};

export const applyInitialOfficeState = (db: OfficeDb, resources: Resource[]) => {
  const createdAt = new Date().toISOString();
  db.roles = structuredClone(INITIAL_ROLES);
  db.users = structuredClone(INITIAL_USERS);
  db.resources = structuredClone(resources);
  db.bookings = structuredClone(INITIAL_BOOKINGS);
  db.departments = structuredClone(INITIAL_DEPARTMENTS);
  db.workflow = structuredClone(DEFAULT_WORKFLOW);
  db.workflowVersions = [{ version: 1, nodes: structuredClone(DEFAULT_WORKFLOW), createdAt, createdBy: 'system' }];
  db.approvalDelegates = [];
  db.workOrders = [];
  db.ruleVersions = [{ version: 1, settings: structuredClone(DEFAULT_RULE_SETTINGS), createdAt, createdBy: 'system' }];
  db.resourceImportBatches = [];
  db.confidentialWhitelist = [];
  db.confidentialityAuthorizations = [];
  db.confidentialAccessGrants = [];
  db.checkInEvents = [];
  db.usageFacts = [];
  db.usageAppeals = [];
  db.devices = [];
  db.exceptionActions = [];
  db.organizationSyncBatches = [];
  db.externalCallbacks = [];
  db.externalCompensations = [];
  db.accessAuthorizationFacts = [];
  db.integrationDeliveries = [];
  db.notifications = [];
  ensureApprovalPolicy(db);
  ensureServiceDomain(db);
};
