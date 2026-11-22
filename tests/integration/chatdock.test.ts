import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
const jsonBody = (value: unknown) => ({ body: JSON.stringify(value) });
const readJson = async (response: Response) => response.json() as Promise<any>;

describe('ChatDock MySQL 持久化', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  it('按 actor 隔离并在重启后恢复对话、草案与操作状态，旧版本不能覆盖', async () => {
    const options = await readJson(await server.request('/api/auth/options'));
    const userId = options.users.find((user: any) => user.name === '李员工').id;
    const adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN')).id;
    const user = await server.login(userId);
    const admin = await server.login(adminId);
    const snapshot = await readJson(await server.request('/api/workspace', { headers: { Cookie: user.cookie } }));
    const resource = snapshot.resources.find((item: any) => item.name === 'Alpha 战略会议室');
    const start = new Date(Date.now() + 9 * 86400000);
    start.setHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const purpose = `ChatDock 持久化 ${Date.now()}`;
    const initial = {
      turns: [
        { role: 'user', content: '帮我准备会议草案' },
        {
          role: 'assistant',
          content: '草案已生成，等待确认。',
          actions: [{
            type: 'PROPOSE_BOOKING',
            summary: '待确认申请',
            draft: {
              userId: adminId,
              resourceId: resource.id,
              startTime: start.toISOString(),
              endTime: end.toISOString(),
              purpose,
              participants: 6,
              meetingType: 'IMPORTANT',
              confidentialityChoice: 'CONFIDENTIAL',
              serviceRequirements: [
                { type: 'SIGNAGE', details: '一楼入口指引' }, { type: 'OTHER', details: '席卡' },
                { type: 'VEHICLE', fieldValues: { quantity: '2', unit: '辆', specification: '七座商务车', serviceTime: '会前 60 分钟', serviceLocation: '北门', estimatedCost: '680' } }
              ],
              exclusiveRequestReason: '临时重要接待',
              auditoriumSetup: { seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 30, notes: '前排预留' },
              requiredFeatures: ['VIDEO'],
              isVideoConference: true
            }
          }]
        }
      ],
      handled: { '1-0': 'dismissed' },
      input: '尚未发送的输入草稿'
    };

    assert.equal((await server.request('/api/agent/conversation')).status, 401);
    const emptyAdmin = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: admin.cookie } }));
    assert.equal(emptyAdmin.revision, 0);
    assert.deepEqual(emptyAdmin.state, { turns: [], handled: {}, input: '' });

    const savedResponse = await server.request('/api/agent/conversation', {
      method: 'PUT',
      headers: { Cookie: user.cookie },
      ...jsonBody({ userId: adminId, revision: 0, state: initial })
    });
    assert.equal(savedResponse.status, 200, JSON.stringify(await readJson(savedResponse.clone())));
    const saved = await readJson(savedResponse);
    assert.equal(saved.revision, 1);
    assert.equal(saved.state.turns[1].actions[0].draft.userId, undefined);
    assert.equal(saved.state.turns[1].actions[0].draft.meetingType, 'IMPORTANT');
    assert.equal(saved.state.turns[1].actions[0].draft.confidentialityChoice, undefined);
    assert.deepEqual(saved.state.turns[1].actions[0].draft.serviceRequirements, [
      { type: 'SIGNAGE', details: '一楼入口指引' }, { type: 'OTHER', details: '席卡' },
      { type: 'VEHICLE', fieldValues: { quantity: '2', unit: '辆', specification: '七座商务车', serviceTime: '会前 60 分钟', serviceLocation: '北门', estimatedCost: '680' } }
    ]);
    assert.equal(saved.state.turns[1].actions[0].draft.exclusiveRequestReason, '临时重要接待');
    assert.equal(saved.state.turns[1].actions[0].draft.auditoriumSetup.seatingLayout, 'CLASSROOM');
    assert.equal(saved.state.handled['1-0'], 'dismissed');
    assert.equal(saved.state.input, initial.input);
    const ownerRows = await queryTestDb<any[]>('SELECT user_id, revision FROM chatdock_conversations WHERE revision > 0');
    assert.deepEqual(ownerRows.map(row => ({ user_id: row.user_id, revision: Number(row.revision) })), [{ user_id: userId, revision: 1 }]);
    const bookings = await queryTestDb<any[]>("SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.purpose')) = ?", [purpose]);
    assert.equal(bookings.length, 0, '保存草案不得自动创建预约');

    const other = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: admin.cookie } }));
    assert.equal(other.revision, 0);
    assert.deepEqual(other.state.turns, []);

    await server.stop();
    await server.start();
    const restored = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: user.cookie } }));
    assert.equal(restored.revision, 1);
    assert.deepEqual(restored.state, saved.state);

    const revised = structuredClone(saved.state);
    revised.turns[1].actions[0].draft.purpose = `${purpose} · 已修订`;
    revised.handled = {};
    revised.input = '';
    const revisedResponse = await server.request('/api/agent/conversation', {
      method: 'PUT', headers: { Cookie: user.cookie }, ...jsonBody({ revision: 1, state: revised })
    });
    assert.equal(revisedResponse.status, 200);
    assert.equal((await readJson(revisedResponse)).revision, 2);
    const stale = await server.request('/api/agent/conversation', {
      method: 'PUT', headers: { Cookie: user.cookie }, ...jsonBody({ revision: 1, state: initial })
    });
    assert.equal(stale.status, 409);
    assert.equal((await readJson(stale)).error, 'CONVERSATION_CONFLICT');
    const afterStale = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: user.cookie } }));
    assert.equal(afterStale.revision, 2);
    assert.equal(afterStale.state.turns[1].actions[0].draft.purpose, `${purpose} · 已修订`);

    const spoofed = await server.request('/api/agent/conversation', {
      method: 'PUT', headers: { Cookie: admin.cookie }, ...jsonBody({ userId, revision: 0, state: initial })
    });
    assert.equal(spoofed.status, 200);
    const ownerAfterSpoof = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: user.cookie } }));
    assert.equal(ownerAfterSpoof.revision, 2);
    assert.equal(ownerAfterSpoof.state.turns[1].actions[0].draft.purpose, `${purpose} · 已修订`);
    const adminOwn = await readJson(await server.request('/api/agent/conversation', { headers: { Cookie: admin.cookie } }));
    assert.equal(adminOwn.revision, 1);
    assert.equal(adminOwn.state.turns[0].content, '帮我准备会议草案');

    const invalid = await server.request('/api/agent/conversation', {
      method: 'PUT', headers: { Cookie: user.cookie }, ...jsonBody({ revision: 2, state: { turns: [{ role: 'system', content: '伪造' }], handled: {}, input: '' } })
    });
    assert.equal(invalid.status, 400);
  });
});
