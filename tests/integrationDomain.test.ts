import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Booking, User } from '../types.ts';
import { syncIntegrationChanges, type IntegrationEventPayload } from '../server/integrationDomain.ts';
import type { OfficeDb } from '../server/tools.ts';

const users: User[] = [
  { id: '3', name: '申请人', email: 'requester@company.com', role: ['EMPLOYEE'], department: '市场部', externalId: 'OA-3', status: 'ACTIVE' },
  { id: '4', name: '参会人', email: 'attendee@company.com', role: ['EMPLOYEE'], department: '市场部', externalId: 'OA-4', status: 'ACTIVE' }
];
const approvedBooking: Booking = {
  id: 'booking-integration-domain', userId: '3', resourceId: 'r1', type: 'ROOM',
  startTime: '2026-12-01T02:00:00.000Z', endTime: '2026-12-01T03:00:00.000Z',
  status: 'APPROVED', purpose: '普通会议', participants: 2, createdAt: '2026-11-01T02:00:00.000Z',
  currentNodeIndex: 1, approvalHistory: [], attendeeIds: ['4'], meetingType: 'NORMAL',
  confidentialityChoice: 'NON_CONFIDENTIAL', scheduleVersion: 1
};

const collectEvents = async (db: OfficeDb, previousBookings: Booking[], previousUsers = users) => {
  const events: Array<{ key: string; type: string; payload: IntegrationEventPayload }> = [];
  await syncIntegrationChanges(db, previousBookings, previousUsers, async event => { events.push(event); }, '2026-11-21T04:00:00.000Z');
  return events;
};

describe('集成领域差异事件', () => {
  it('同版本移除参会人只撤销该用户，不影响申请人授权', async () => {
    const next = { ...approvedBooking, attendeeIds: [] };
    const db: OfficeDb = {
      users, bookings: [next], resources: [],
      accessAuthorizationFacts: ['3', '4'].map(userId => ({
        id: `access-fact:${next.id}:v1:${userId}`, bookingId: next.id, scheduleVersion: 1, userId,
        resourceId: 'r1', status: 'AUTHORIZED', validFrom: next.startTime, validTo: next.endTime,
        grantRequestedAt: next.createdAt, grantAcknowledgedAt: next.createdAt
      }))
    };
    const events = await collectEvents(db, [approvedBooking]);
    assert.equal(events.length, 1);
    assert.equal(events[0].key, `access:${next.id}:v1:REVOKE:USER:4`);
    assert.equal(events[0].type, 'ACCESS_CONTROL');
    assert.ok('subjects' in events[0].payload);
    if (!('subjects' in events[0].payload)) return;
    assert.deepEqual(events[0].payload.subjects, [{ userId: '4', externalId: 'OA-4' }]);
    assert.equal(events[0].payload.reason, 'ATTENDEE_REMOVED');
    assert.equal(db.accessAuthorizationFacts?.find(item => item.userId === '3')?.status, 'AUTHORIZED');
    assert.equal(db.accessAuthorizationFacts?.find(item => item.userId === '4')?.status, 'REVOKED');
    assert.equal(db.accessAuthorizationFacts?.find(item => item.userId === '4')?.revocationReason, 'ATTENDEE_REMOVED');
  });

  it('涉密日历只外发通用标题和外部人员标识，不发送地点与真实用途', async () => {
    const secret = '涉密项目真实用途不得外发';
    const booking: Booking = {
      ...approvedBooking, id: 'booking-confidential-integration', purpose: secret,
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    };
    const db: OfficeDb = {
      users, bookings: [booking],
      resources: [{ id: 'r1', name: '涉密地点不得外发', type: 'ROOM', capacity: 8, location: '主楼 16 层', features: [], status: 'AVAILABLE', isPublic: true }]
    };
    const events = await collectEvents(db, []);
    assert.deepEqual(events.map(item => item.key), [
      `calendar:${booking.id}:v1:UPSERT`, `access:${booking.id}:v1:GRANT:ALL`
    ]);
    const calendar = events[0].payload;
    assert.ok('attendees' in calendar);
    if (!('attendees' in calendar)) return;
    assert.equal(calendar.title, '涉密会议（请登录系统查看）');
    assert.equal(calendar.location, undefined);
    assert.deepEqual(calendar.attendees.sort(), ['OA-3', 'OA-4']);
    assert.ok(!JSON.stringify(calendar).includes(secret));
    assert.ok(!JSON.stringify(calendar).includes('涉密地点不得外发'));
    assert.ok(!JSON.stringify(events[1].payload).includes(secret));
  });
});
