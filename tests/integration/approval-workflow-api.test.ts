import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ApprovalDelegate, ApprovalNode, Booking, WorkflowVersion } from '../../types.ts';
import { integrationEnabled, mutateTestCollection, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
const jsonBody = (value: unknown) => ({ body: JSON.stringify(value) });
const readJson = async (response: Response) => response.json() as Promise<any>;

let adminId = '';
let requesterId = '';
let approverId = '';
let approverName = '';
const delegateId = 'u-approval-delegate';
const resourceId = 'r-approval-integration';
let admin: Awaited<ReturnType<TestServer['login']>>;
let requester: Awaited<ReturnType<TestServer['login']>>;
let approver: Awaited<ReturnType<TestServer['login']>>;
let delegate: Awaited<ReturnType<TestServer['login']>>;
let bookingSequence = 0;

const publishWorkflow = async (workflow: ApprovalNode[]) => {
  const response = await server.request('/api/workflow', {
    method: 'PUT', headers: { Cookie: admin.cookie }, ...jsonBody({ workflow })
  });
  assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
  return readJson(response);
};

const createBooking = async (
  session: Awaited<ReturnType<TestServer['login']>>,
  purpose: string,
  overrides: Record<string, unknown> = {}
): Promise<Booking> => {
  const start = new Date(Date.now() + (30 + bookingSequence++) * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const booking = {
    id: crypto.randomUUID(), userId: adminId, resourceId, type: 'ROOM',
    startTime: start.toISOString(), endTime: end.toISOString(), status: 'PENDING',
    purpose, participants: 2, meetingType: 'IMPORTANT', confidentialityChoice: 'NON_CONFIDENTIAL', createdAt: new Date().toISOString(), currentNodeIndex: 0,
    approvalHistory: [], ...overrides
  };
  const response = await server.request('/api/bookings', {
    method: 'POST', headers: { Cookie: session.cookie }, ...jsonBody({ booking })
  });
  assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
  return (await readJson(response)).booking;
};

const approve = (session: Awaited<ReturnType<TestServer['login']>>, bookingId: string) =>
  server.request('/api/agent/action', {
    method: 'POST', headers: { Cookie: session.cookie }, ...jsonBody({
      action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: '集成测试通过', summary: '通过审批' }
    })
  });

const readBooking = async (bookingId: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(rows.length, 1);
  return (typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload) as Booking;
};

const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};

describe('第五迭代审批模型 API 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
    const options = await readJson(await server.request('/api/auth/options'));
    adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
    requesterId = options.users.find((user: any) => user.name === '李员工')?.id;
    const approverOption = options.users.find((user: any) => user.role.includes('APPROVAL_ADMIN'));
    approverId = approverOption?.id;
    approverName = approverOption?.name;
    assert.ok(adminId && requesterId && approverId && approverName);
    [admin, requester, approver] = await Promise.all([
      server.login(adminId), server.login(requesterId), server.login(approverId)
    ]);

    const userResponse = await server.request('/api/users', {
      method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({
        user: {
          id: delegateId, name: '代理审批员', email: 'approval-delegate@company.com',
          role: ['EMPLOYEE'], department: '行政部'
        }
      })
    });
    assert.equal(userResponse.status, 201, JSON.stringify(await readJson(userResponse.clone())));
    delegate = await server.login(delegateId);

    const resourceResponse = await server.request('/api/resources', {
      method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({
        resource: {
          id: resourceId, name: '第五迭代集成会议室', type: 'ROOM', capacity: 10,
          location: '测试楼 5层', campus: '集成测试园区', features: [], status: 'AVAILABLE'
        }
      })
    });
    assert.equal(resourceResponse.status, 201, JSON.stringify(await readJson(resourceResponse.clone())));
  });

  after(async () => {
    await server.stop();
  });

  it('提交时冻结 workflowVersion、approvalWorkflow、requesterDepartmentId 和 resourceCampus', async () => {
    const published = await publishWorkflow([
      { id: 'freeze-n1', name: '冻结行政初审', approverRole: 'APPROVAL_ADMIN', departmentIds: ['dpt-root'], campuses: ['集成测试园区'] },
      { id: 'freeze-n2', name: '冻结系统复核', approverRole: 'SYSTEM_ADMIN' }
    ]);
    const versions = await readCollection<WorkflowVersion>('workflowVersions');
    const currentVersion = Math.max(...versions.map(version => version.version));
    const requesterDepartment = published.workspace.departments.find((department: any) => department.name === '市场部');
    assert.ok(requesterDepartment);

    const booking = await createBooking(requester, '提交时冻结审批上下文', {
      workflowVersion: 999,
      approvalWorkflow: [{ id: 'forged', name: '伪造节点', approverRole: 'EMPLOYEE' }],
      requesterDepartmentId: 'dpt-root',
      resourceCampus: '伪造园区',
      status: 'APPROVED'
    });
    assert.equal(booking.workflowVersion, currentVersion);
    assert.deepEqual(booking.approvalWorkflow, published.workflow);
    assert.equal(booking.requesterDepartmentId, requesterDepartment.id);
    assert.equal(booking.resourceCampus, '集成测试园区');
    assert.equal(booking.userId, requesterId);
    assert.equal(booking.status, 'PENDING');
    assert.deepEqual((await readBooking(booking.id)).approvalWorkflow, published.workflow);
  });

  it('越权审批和申请人自审均被 403 拒绝且不写审批历史', async () => {
    await publishWorkflow([{ id: 'deny-n1', name: '行政审批', approverRole: 'APPROVAL_ADMIN' }]);
    const booking = await createBooking(approver, '越权与自审拒绝');

    const unauthorized = await approve(requester, booking.id);
    assert.equal(unauthorized.status, 403);
    const selfApproval = await approve(approver, booking.id);
    assert.equal(selfApproval.status, 403);

    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'PENDING');
    assert.equal(persisted.currentNodeIndex, 0);
    assert.deepEqual(persisted.approvalHistory, []);
  });

  it('流程发布后旧申请仍按冻结的旧节点审批', async () => {
    await publishWorkflow([{ id: 'old-node', name: '旧行政节点', approverRole: 'APPROVAL_ADMIN' }]);
    const booking = await createBooking(requester, '旧流程申请');
    await publishWorkflow([{ id: 'new-node', name: '新系统节点', approverRole: 'SYSTEM_ADMIN' }]);

    const approved = await approve(approver, booking.id);
    assert.equal(approved.status, 200, JSON.stringify(await readJson(approved.clone())));
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'APPROVED');
    assert.equal(persisted.approvalHistory.length, 1);
    assert.equal(persisted.approvalHistory[0].nodeName, '旧行政节点');
    assert.equal(persisted.approvalHistory[0].approverId, approverId);
  });

  it('有效代理可审并记录双方身份，过期代理不可审', async () => {
    await publishWorkflow([{ id: 'delegate-node', name: '委托行政节点', approverRole: 'APPROVAL_ADMIN' }]);
    const delegatedBooking = await createBooking(requester, '有效代理审批');
    const expiredBooking = await createBooking(requester, '过期代理审批');
    const delegationResponse = await server.request('/api/approval-delegates', {
      method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({
        delegate: {
          id: 'delegation-integration', delegatorId: approverId, delegateId,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString()
        }
      })
    });
    assert.equal(delegationResponse.status, 201, JSON.stringify(await readJson(delegationResponse.clone())));

    const approved = await approve(delegate, delegatedBooking.id);
    assert.equal(approved.status, 200, JSON.stringify(await readJson(approved.clone())));
    const record = (await readBooking(delegatedBooking.id)).approvalHistory[0];
    assert.equal(record.approverId, delegateId);
    assert.equal(record.delegatorId, approverId);
    assert.equal(record.delegatorName, approverName);

    await mutateTestCollection<ApprovalDelegate>('approvalDelegates', delegations => delegations.map(item =>
      item.id === 'delegation-integration' ? {
        ...item,
        startsAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        endsAt: new Date(Date.now() - 3600000).toISOString()
      } : item
    ));

    const expired = await approve(delegate, expiredBooking.id);
    assert.equal(expired.ok, false);
    const pending = await readBooking(expiredBooking.id);
    assert.equal(pending.status, 'PENDING');
    assert.deepEqual(pending.approvalHistory, []);
  });

  it('重复审批失败且不会重复写入审批历史', async () => {
    await publishWorkflow([{ id: 'repeat-node', name: '重复审批节点', approverRole: 'APPROVAL_ADMIN' }]);
    const booking = await createBooking(requester, '重复审批检查');
    assert.equal((await approve(approver, booking.id)).status, 200);
    const repeated = await approve(approver, booking.id);
    assert.equal(repeated.ok, false);
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'APPROVED');
    assert.equal(persisted.approvalHistory.length, 1);
  });

  it('两个并发审批请求至多一个成功且只保留一条审批记录', async () => {
    await publishWorkflow([{ id: 'concurrent-node', name: '并发审批节点', approverRole: 'APPROVAL_ADMIN' }]);
    const booking = await createBooking(requester, '并发审批检查');
    const responses = await Promise.all([approve(approver, booking.id), approve(approver, booking.id)]);
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => !response.ok).length, 1);
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'APPROVED');
    assert.equal(persisted.approvalHistory.length, 1);
  });
});
