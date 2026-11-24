import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutor, parseTime, toolsForRoles, buildContextSummary, buildTodos, type OfficeDb } from '../server/tools.ts';
import type { Booking } from '../types.ts';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

const NOW = at(19, 22, 45);

const makeDb = (): OfficeDb => ({
  roles: [
    { id: 'SYSTEM_ADMIN', name: '系统管理员', description: '', color: 'indigo' },
    { id: 'APPROVAL_ADMIN', name: '审批负责人', description: '', color: 'amber' },
    { id: 'EMPLOYEE', name: '正式员工', description: '', color: 'emerald' }
  ],
  users: [
    { id: '1', name: '超级管理员', email: 'a@company.com', role: ['SYSTEM_ADMIN'], department: '架构组' },
    { id: '2', name: '审批负责人', email: 'b@company.com', role: ['APPROVAL_ADMIN'], department: '行政部' },
    { id: '3', name: '李员工', email: 'c@company.com', role: ['EMPLOYEE'], department: '市场部' }
  ],
  resources: [
    { id: 'r1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 10, location: '1号楼 10层', features: ['投屏显示器', '视频会议系统'], status: 'AVAILABLE' },
    { id: 'r2', name: 'Beta 灵感会议室', type: 'ROOM', capacity: 4, location: '1号楼 10层', features: ['白板', '多孔插座', '视频会议系统'], status: 'AVAILABLE' },
    { id: 'd1', name: '工位 A-101', type: 'DESK', location: 'A办公区', features: ['双显示器'], status: 'AVAILABLE' }
  ],
  bookings: [
    {
      id: 'b1', userId: '3', resourceId: 'r1', type: 'ROOM',
      startTime: at(20, 15).toISOString(), endTime: at(20, 16).toISOString(),
      status: 'APPROVED', purpose: '周会', createdAt: at(18, 9).toISOString(),
      currentNodeIndex: 1, approvalHistory: []
    } satisfies Booking
  ],
  departments: [
    { id: 'dpt-root', name: '集团总部' },
    { id: 'dpt-tech', name: '信息技术部', parentId: 'dpt-root' },
    { id: 'dpt-arch', name: '架构组', parentId: 'dpt-tech' },
    { id: 'dpt-admin', name: '行政部', parentId: 'dpt-root' },
    { id: 'dpt-market', name: '市场部', parentId: 'dpt-root' }
  ],
  workflow: [
    { id: 'n1', name: '行政预审', approverRole: 'APPROVAL_ADMIN' },
    { id: 'n2', name: '最终核准', approverRole: 'SYSTEM_ADMIN' }
  ],
  approvalDelegates: [],
  workOrders: []
});

const exec = (userId: string) => createExecutor(makeDb(), { userId, now: NOW });

test('parseTime 把无时区时间按本地时区解析，不偏移 8 小时', () => {
  const parsed = parseTime('2026-11-20T15:00');
  assert.ok(parsed);
  assert.equal(parsed!.getHours(), 15);
  assert.equal(parsed!.getDate(), 20);
  assert.equal(parseTime('不是时间'), null);
});

test('find_available_resources 按人数和设备过滤', () => {
  const result = exec('3').find_available_resources({
    startTime: '2026-11-20T15:00',
    endTime: '2026-11-20T16:00',
    participants: 10,
    features: ['视频']
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.total, 0);
  assert.match(result.hint || '', /下一个空闲|换个时间/);

  const free = exec('3').find_available_resources({
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    participants: 10,
    features: ['视频']
  });
  assert.equal(free.ok, true);
  assert.equal(free.data.total, 1);
  assert.equal(free.data.candidates[0].name, 'Alpha 战略会议室');
});

test('find_available_resources 允许当前占用资源的未来空档并排除维护资源', () => {
  const db = makeDb();
  db.resources![0].status = 'OCCUPIED';
  db.resources![1].status = 'MAINTENANCE';
  const result = createExecutor(db, { userId: '3', now: NOW }).find_available_resources({
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    participants: 2
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.candidates.map((resource: { name: string }) => resource.name), ['Alpha 战略会议室']);
});

test('find_available_resources 拒绝非法时间区间', () => {
  const result = exec('3').find_available_resources({
    startTime: '2026-11-20T16:00',
    endTime: '2026-11-20T15:00'
  });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /结束时间/);
});

test('propose_booking 冲突时不生成提案，并给出最近空档', () => {
  const result = exec('3').propose_booking({
    resourceName: 'Alpha',
    startTime: '2026-11-20T15:00',
    endTime: '2026-11-20T16:00',
    purpose: '项目评审',
    participants: 8
  });
  assert.equal(result.ok, false);
  assert.equal(result.action, undefined);
  assert.match(result.error || '', /已被占用/);
  assert.match(result.error || '', /最近空档/);
});

test('propose_booking 要求明确主题和必填正整数人数，不自动补默认值', () => {
  const base = { resourceName: 'Beta', startTime: '2026-11-20T10:00', endTime: '2026-11-20T11:00', purpose: '项目评审' };
  for (const participants of [undefined, 0, -1, 1.5, 'four']) {
    const result = exec('3').propose_booking({ ...base, participants });
    assert.equal(result.ok, false);
    assert.equal(result.action, undefined);
    assert.match(result.error || '', /参与人数必填/);
  }
  for (const purpose of ['', ' ', '会议', '开会', ' 会 议 ', '开\n会']) {
    const result = exec('3').propose_booking({ ...base, purpose, participants: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.action, undefined);
    assert.match(result.error || '', /明确主题/);
  }
  const accepted = exec('3').propose_booking({ ...base, participants: 1 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.draft.participants, 1);
});

test('propose_booking 成功时返回可直接提交的草稿', () => {
  const result = exec('3').propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    purpose: '一对一沟通',
    participants: 2,
    needsTea: true,
    needsVideo: true,
    attendeeNames: ['审批负责人'],
    hasLeader: true,
    leaderDetails: '市场部总监',
    repeatFrequency: 'BIWEEKLY',
    repeatCount: 6
  });
  assert.equal(result.ok, true);
  assert.equal(result.action?.type, 'PROPOSE_BOOKING');
  assert.equal(result.data.draft.status, 'PENDING');
  assert.equal(result.data.draft.userId, '3');
  assert.equal(result.data.draft.resourceId, 'r2');
  assert.equal(result.data.draft.needsTeaService, true);
  assert.equal(result.data.draft.isVideoConference, true);
  assert.deepEqual(result.data.draft.requiredFeatures, ['VIDEO']);
  assert.deepEqual(result.data.draft.attendeeIds, ['2']);
  assert.equal(result.data.draft.hasLeader, true);
  assert.equal(result.data.draft.leaderDetails, '市场部总监');
  assert.deepEqual(result.data.draft.recurrence, { frequency: 'BIWEEKLY', count: 6 });
  assert.match(result.data.summary, /Beta 灵感会议室/);
});

test('propose_booking 仅生成普通或重要会议草案并保留明确服务与礼堂参数', () => {
  const confidential = exec('3').propose_booking({
    resourceName: 'Beta', startTime: '2026-11-20T10:00', endTime: '2026-11-20T11:00',
    purpose: '涉密讨论', meetingType: 'CONFIDENTIAL'
  });
  assert.equal(confidential.ok, false);
  assert.equal(confidential.action, undefined);
  assert.match(confidential.error || '', /正式表单/);

  const db = makeDb();
  Object.assign(db.resources![1], { roomCategory: 'AUDITORIUM', isExclusive: true });
  const result = createExecutor(db, { userId: '3', now: NOW }).propose_booking({
    resourceName: 'Beta', startTime: '2026-11-20T10:00', endTime: '2026-11-20T11:00',
    purpose: '重要接待', meetingType: 'IMPORTANT', participants: 2,
    serviceRequirements: [
      { type: 'SIGNAGE', details: '入口指引' }, { type: 'OTHER', details: '席卡' },
      { type: 'VEHICLE', fieldValues: { quantity: '2', unit: '辆', specification: '七座商务车', serviceTime: '会前 60 分钟', serviceLocation: '北门', estimatedCost: '680' } }
    ],
    exclusiveRequestReason: '临时重要接待',
    auditoriumSetup: { seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 30, notes: '前排预留' }
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.draft.meetingType, 'IMPORTANT');
  assert.equal(result.data.draft.confidentialityChoice, undefined);
  assert.deepEqual(result.data.draft.serviceRequirements, [
    { type: 'SIGNAGE', details: '入口指引' }, { type: 'OTHER', details: '席卡' },
    { type: 'VEHICLE', fieldValues: { quantity: '2', unit: '辆', specification: '七座商务车', serviceTime: '会前 60 分钟', serviceLocation: '北门', estimatedCost: '680' } }
  ]);
  assert.equal(result.data.draft.exclusiveRequestReason, '临时重要接待');
  assert.equal(result.data.draft.auditoriumSetup.seatingLayout, 'CLASSROOM');

  const schema = toolsForRoles(['EMPLOYEE']).find(tool => tool.function.name === 'propose_booking');
  assert.equal(Object.prototype.hasOwnProperty.call(schema?.function.parameters.properties, 'confidentialityChoice'), false);
});

test('propose_booking 与正式预约使用相同的维护和设备约束', () => {
  const db = makeDb();
  db.resources![1].features = ['白板'];
  const missingVideo = createExecutor(db, { userId: '3', now: NOW }).propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    purpose: '远程沟通',
    participants: 2,
    needsVideo: true
  });
  assert.equal(missingVideo.ok, false);
  assert.match(missingVideo.error || '', /未配置视频会议系统/);

  db.resources![1].status = 'MAINTENANCE';
  const maintenance = createExecutor(db, { userId: '3', now: NOW }).propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    purpose: '远程沟通',
    participants: 2
  });
  assert.equal(maintenance.ok, false);
  assert.match(maintenance.error || '', /MAINTENANCE.*不可预订/);
});

test('propose_booking 拦截超过容量的预订', () => {
  const result = exec('3').propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    purpose: '全员会',
    participants: 8
  });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /只能容纳 4 人/);
});

test('propose_booking 拦截过去的时间和超长预订', () => {
  const past = exec('3').propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-19T09:00',
    endTime: '2026-11-19T10:00',
    purpose: '补录'
  });
  assert.equal(past.ok, false);
  assert.match(past.error || '', /已经过去/);

  const tooLong = exec('3').propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T09:00',
    endTime: '2026-11-20T19:00',
    purpose: '全天'
  });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error || '', /8 小时|可预订时段/);
});

test('资源名称支持关键词模糊匹配，歧义时返回候选', () => {
  const hit = exec('3').propose_booking({
    resourceName: '战略',
    startTime: '2026-11-21T10:00',
    endTime: '2026-11-21T11:00',
    purpose: '战略讨论',
    participants: 6
  });
  assert.equal(hit.ok, true);

  const ambiguous = exec('3').propose_booking({
    resourceName: '会议室',
    startTime: '2026-11-21T10:00',
    endTime: '2026-11-21T11:00',
    purpose: '讨论',
    participants: 2
  });
  assert.equal(ambiguous.ok, false);
  assert.ok((ambiguous.candidates || []).length >= 2);
});

test('propose_cancel 只允许取消自己的预订', () => {
  const others = exec('1').propose_cancel({ bookingKeyword: '周会' });
  assert.equal(others.ok, false);

  const mine = exec('3').propose_cancel({ bookingKeyword: '周会' });
  assert.equal(mine.ok, true);
  assert.equal(mine.action?.type, 'PROPOSE_CANCEL');
  assert.equal((mine.action as any).bookingId, 'b1');
});

test('propose_approval 走通审批流转，驳回必须填意见', () => {
  const approver = exec('2');
  const pendingDb = makeDb();
  pendingDb.bookings![0].status = 'PENDING';
  pendingDb.bookings![0].currentNodeIndex = 0;
  const approveExec = createExecutor(pendingDb, { userId: '2', now: NOW });

  const noComment = approveExec.propose_approval({ bookingKeyword: '李员工', decision: 'REJECT' });
  assert.equal(noComment.ok, false);
  assert.match(noComment.error || '', /审批意见/);

  const approved = approveExec.propose_approval({ bookingKeyword: '李员工', decision: 'APPROVE' });
  assert.equal(approved.ok, true);
  assert.equal(approved.action?.type, 'PROPOSE_APPROVAL');
  assert.equal(approved.data.resultStatus, 'PENDING');
  assert.equal(approved.data.nextNode, '最终核准');

  const employee = createExecutor(pendingDb, { userId: '3', now: NOW });
  const denied = employee.propose_approval({ bookingKeyword: '周会', decision: 'APPROVE' });
  assert.equal(denied.ok, false);
  assert.match(denied.error || '', /没有匹配的待审批/);

  assert.equal(approver.get_pending_approvals({}).ok, true);
  assert.equal(approveExec.get_pending_approvals({}).data.total, 1);
});

test('长期系列待审查询、提案和待办共用同一组会议日', () => {
  const db = makeDb();
  db.bookings = [0, 1].map(index => ({
    ...db.bookings![0],
    id: `long-${index + 1}`,
    status: 'PENDING' as const,
    currentNodeIndex: 0,
    purpose: '长期例会',
    seriesId: 'series-1',
    seriesKind: 'LONG_TERM' as const,
    seriesEndDate: '2026-11-21',
    startTime: at(20 + index, 10).toISOString(),
    endTime: at(20 + index, 11).toISOString()
  }));
  const approver = createExecutor(db, { userId: '2', now: NOW });
  const pending = approver.get_pending_approvals({});
  assert.equal(pending.data.total, 1);
  assert.equal(pending.data.pending[0].occurrenceCount, 2);
  assert.deepEqual(pending.data.pending[0].bookingIds, ['long-1', 'long-2']);

  const proposal = approver.propose_approval({ bookingKeyword: '长期例会', decision: 'APPROVE' });
  assert.equal(proposal.ok, true);
  const proposalAction = proposal.action;
  assert.equal(proposalAction?.type, 'PROPOSE_APPROVAL');
  if (proposalAction?.type === 'PROPOSE_APPROVAL') {
    assert.deepEqual(proposalAction.bookingIds, ['long-1', 'long-2']);
    assert.match(proposalAction.summary, /2 个会议日/);
  }

  const todos = buildTodos(db, '2', NOW).filter(todo => todo.kind === 'APPROVAL');
  assert.equal(todos.length, 1);
  const action = todos[0].actions[0];
  assert.equal(action.type, 'PROPOSE_APPROVAL');
  if (action.type === 'PROPOSE_APPROVAL') assert.deepEqual(action.bookingIds, ['long-1', 'long-2']);
});

test('get_usage_stats 聚合出状态、热门资源和高峰时段', () => {
  const result = exec('1').get_usage_stats({ days: 30 });
  assert.equal(result.ok, true);
  assert.equal(result.data.totalBookings, 1);
  assert.equal(result.data.byStatus.APPROVED, 1);
  assert.equal(result.data.topResources[0].name, 'Alpha 战略会议室');
  assert.equal(result.data.busiestHours[0].hour, '15:00');
});

test('角色裁剪隐藏审批与管理类工具', () => {
  const employee = toolsForRoles(['EMPLOYEE']).map(t => t.function.name);
  assert.ok(employee.includes('find_available_resources'));
  assert.ok(!employee.includes('get_pending_approvals'));
  assert.ok(!employee.includes('get_usage_stats'));

  const admin = toolsForRoles(['SYSTEM_ADMIN']).map(t => t.function.name);
  assert.ok(admin.includes('get_pending_approvals'));
  assert.ok(admin.includes('get_usage_stats'));

  const customApprover = toolsForRoles(['DEPARTMENT_MANAGER'], [{ id: 'n1', name: '部门审批', approverRole: 'DEPARTMENT_MANAGER' }]).map(t => t.function.name);
  assert.ok(customApprover.includes('get_pending_approvals'));
  assert.ok(customApprover.includes('propose_approval'));
  assert.ok(!customApprover.includes('get_usage_stats'));
});

test('未知用户调用写操作会被拦下', () => {
  const result = createExecutor(makeDb(), { userId: 'ghost', now: NOW }).propose_booking({
    resourceName: 'Beta',
    startTime: '2026-11-20T10:00',
    endTime: '2026-11-20T11:00',
    purpose: '讨论'
  });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /无法识别当前用户/);
});

test('上下文摘要带出当前时间、身份与资源清单', () => {
  const summary = buildContextSummary(makeDb(), { userId: '3', now: NOW });
  assert.match(summary, /2026-11-19 22:45/);
  assert.match(summary, /李员工/);
  assert.match(summary, /Alpha 战略会议室/);
  assert.match(summary, /行政预审/);
});

test('待办按用户路由，并携带可执行的审批、签到与工单动作', () => {
  const db = makeDb();
  db.bookings![0].status = 'PENDING';
  db.bookings![0].currentNodeIndex = 0;
  db.bookings!.push({
    ...db.bookings![0], id: 'b2', status: 'APPROVED', purpose: '站会',
    startTime: at(19, 22, 55).toISOString(), endTime: at(19, 23, 30).toISOString()
  });
  db.workOrders = [{ id: 'w1', bookingId: 'b1', type: 'TEA', title: '茶水服务', assigneeRole: 'APPROVAL_ADMIN', status: 'TODO', createdAt: NOW.toISOString() }];

  const employee = buildTodos(db, '3', NOW);
  assert.ok(employee.some(t => t.id === 'checkin-b2' && t.actions[0].type === 'PROPOSE_CHECK_IN'));
  assert.ok(!employee.some(t => t.kind === 'APPROVAL' || t.kind === 'WORK_ORDER'));

  const approver = buildTodos(db, '2', NOW);
  assert.ok(approver.some(t => t.id === 'approval-b1' && t.actions[0].type === 'PROPOSE_APPROVAL'));
  assert.ok(approver.some(t => t.id === 'workorder-w1' && t.actions[0].type === 'PROPOSE_WORK_ORDER'));
  assert.equal(createExecutor(db, { userId: '3', now: NOW }).get_my_todos({}).data.total, employee.length);
});

test('帮助检索和系统导航只暴露当前角色可用功能', () => {
  const employee = exec('3');
  const employeeReport = employee.search_help({ query: '运营报表' });
  assert.equal(employeeReport.ok, true);
  assert.equal(employeeReport.data.total, 0);
  const employeeLayoutImport = employee.search_help({ query: '楼层图导入' });
  assert.equal(employeeLayoutImport.ok, true);
  assert.equal(employeeLayoutImport.data.total, 0);
  assert.equal(employee.navigate_system({ view: 'REPORTS' }).ok, false);
  assert.equal(employee.navigate_system({ view: '__PROTO__' }).ok, false);

  const employeeBooking = employee.search_help({ query: '修改预约' });
  assert.equal(employeeBooking.action?.type, 'OPEN_HELP');
  if (employeeBooking.action?.type === 'OPEN_HELP') assert.equal(employeeBooking.action.topicId, 'booking-edit');
  const resourceNavigation = employee.navigate_system({ view: 'RESOURCES' }).action;
  assert.equal(resourceNavigation?.type, 'NAVIGATE');
  if (resourceNavigation?.type === 'NAVIGATE') assert.equal(resourceNavigation.view, 'RESOURCES');

  const admin = exec('1');
  const adminReport = admin.search_help({ query: '运营报表' });
  assert.equal(adminReport.action?.type, 'OPEN_HELP');
  if (adminReport.action?.type === 'OPEN_HELP') assert.equal(adminReport.action.topicId, 'reports');
  const adminLayoutImport = admin.search_help({ query: '楼层图导入' });
  assert.equal(adminLayoutImport.action?.type, 'OPEN_HELP');
  if (adminLayoutImport.action?.type === 'OPEN_HELP') assert.equal(adminLayoutImport.action.topicId, 'hq-layout-import');
  for (const query of ['Excel楼层图', '原生楼层图Excel', '打印区域', '图片OCR']) {
    const result = admin.search_help({ query });
    assert.equal(result.action?.type, 'OPEN_HELP');
    if (result.action?.type === 'OPEN_HELP') assert.equal(result.action.topicId, 'hq-layout-import');
  }
  assert.equal(admin.navigate_system({ view: 'REPORTS' }).ok, true);
  assert.equal(admin.navigate_system({ view: 'DATA_CENTER' }).ok, true);
});

test('修改预约只生成表单草案，冲突排除自身且禁止他人和涉密预约', () => {
  const result = exec('3').propose_edit_booking({
    bookingKeyword: '周会',
    startTime: '2026-11-20T15:00',
    endTime: '2026-11-20T16:00',
    purpose: '周会复盘',
    participants: 8
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.action?.type, 'PROPOSE_EDIT_BOOKING');
  if (result.action?.type === 'PROPOSE_EDIT_BOOKING') {
    assert.equal(result.action.bookingId, 'b1');
    assert.equal(result.action.draft.purpose, '周会复盘');
  }
  assert.equal(exec('1').propose_edit_booking({ bookingKeyword: '周会' }).ok, false);

  const db = makeDb();
  db.bookings![0].meetingType = 'CONFIDENTIAL';
  assert.equal(createExecutor(db, { userId: '3', now: NOW }).propose_edit_booking({ bookingKeyword: '周会' }).ok, false);
});

test('长期预约续期要求本人、已核准首条且没有待审或活跃续期', () => {
  const db = makeDb();
  Object.assign(db.bookings![0], { seriesId: 'series-1', seriesKind: 'LONG_TERM', recurrenceIndex: 0, seriesEndDate: '2026-11-20' });
  const renewed = createExecutor(db, { userId: '3', now: NOW }).propose_renew_booking({ bookingKeyword: '周会' });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.action?.type, 'PROPOSE_RENEW_BOOKING');

  db.bookings!.push({ ...db.bookings![0], id: 'renewal-1', seriesId: 'renewal-series-1', renewalOfSeriesId: 'series-1' });
  assert.match(createExecutor(db, { userId: '3', now: NOW }).propose_renew_booking({ bookingKeyword: 'b1' }).error || '', /已有/);

  const pending = makeDb();
  Object.assign(pending.bookings![0], { seriesId: 'series-1', seriesKind: 'LONG_TERM', recurrenceIndex: 0, status: 'PENDING' });
  assert.equal(createExecutor(pending, { userId: '3', now: NOW }).propose_renew_booking({ bookingKeyword: '周会' }).ok, false);
});

test('会务角色获得工单工具，参会人可在会前15分钟签到且结束后禁止签到', () => {
  const coordinatorTools = toolsForRoles(['SERVICE_COORDINATOR']).map(tool => tool.function.name);
  assert.ok(coordinatorTools.includes('get_work_orders'));
  assert.ok(coordinatorTools.includes('propose_complete_work_order'));
  const customTools = toolsForRoles(['CUSTOM_SERVICE'], [], [{ id: 'w1', bookingId: 'b1', type: 'TEA', title: '茶水', assigneeRole: 'CUSTOM_SERVICE', status: 'TODO', createdAt: NOW.toISOString() }]).map(tool => tool.function.name);
  assert.ok(customTools.includes('get_work_orders'));

  const db = makeDb();
  Object.assign(db.bookings![0], {
    attendeeIds: ['2'],
    startTime: at(19, 23).toISOString(),
    endTime: at(19, 23, 30).toISOString()
  });
  const attendee = createExecutor(db, { userId: '2', now: NOW }).propose_check_in({ bookingKeyword: '周会' });
  assert.equal(attendee.ok, true);
  assert.equal(attendee.action?.type, 'PROPOSE_CHECK_IN');

  db.bookings![0].startTime = at(19, 23, 1).toISOString();
  assert.match(createExecutor(db, { userId: '2', now: NOW }).propose_check_in({ bookingKeyword: '周会' }).error || '', /15 分钟/);
  db.bookings![0].startTime = at(19, 21).toISOString();
  db.bookings![0].endTime = at(19, 22).toISOString();
  assert.match(createExecutor(db, { userId: '2', now: NOW }).propose_check_in({ bookingKeyword: '周会' }).error || '', /已经结束/);
});

test('参会人未匹配或歧义时明确报错，不再静默丢弃', () => {
  const base = { resourceName: 'Beta', startTime: '2026-11-20T10:00', endTime: '2026-11-20T11:00', purpose: '项目评审', participants: 2 };
  const missing = exec('3').propose_booking({ ...base, attendeeNames: ['不存在成员'] });
  assert.equal(missing.ok, false);
  assert.match(missing.error || '', /没有找到/);

  const db = makeDb();
  db.users!.push({ id: '4', name: '李员工', email: 'c2@company.com', role: ['EMPLOYEE'], department: '市场部' });
  const ambiguous = createExecutor(db, { userId: '3', now: NOW }).propose_booking({ ...base, attendeeNames: ['李员工'] });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error || '', /多位成员/);
  assert.equal(ambiguous.candidates.length, 2);
});
