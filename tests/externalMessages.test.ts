import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Notification, User } from '../types.ts';
import { deliverExternalNotification, externalNotificationEvents, type ExternalNotificationPayload } from '../server/externalMessages.ts';

const envKeys = [
  'SMART_OFFICE_WECOM_ENABLED', 'SMART_OFFICE_WECOM_URL',
  'SMART_OFFICE_SMS_ENABLED', 'SMART_OFFICE_SMS_URL',
  'SMART_OFFICE_EMAIL_ENABLED', 'SMART_OFFICE_EMAIL_URL'
];
const original = new Map<string, string | undefined>();
const notification: Notification = {
  id: 'notice-1', userId: 'user-1', title: '预约申请已提交',
  content: '不应外发的会议正文', timestamp: new Date().toISOString(), isRead: false, type: 'INFO'
};
const user: User = {
  id: 'user-1', name: '测试用户', email: 'user@example.com', mobile: '13800000000',
  externalId: 'HR-1001', role: ['EMPLOYEE'], department: '市场部'
};
const payload: ExternalNotificationPayload = {
  notificationId: notification.id, channel: 'WECOM', recipient: user.externalId!,
  title: notification.title, occurredAt: notification.timestamp
};

describe('外部消息路由边界', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it('所有渠道默认关闭，关闭的已入队事件明确跳过', async () => {
    assert.deepEqual(externalNotificationEvents(notification, [user]), []);
    assert.deepEqual(await deliverExternalNotification(payload, 'external-notification:WECOM:notice-1'), {
      outcome: 'SKIPPED', reason: 'DISABLED'
    });
  });

  it('企业微信和邮件接收普通提醒，短信只接收紧急提醒且事件不保存正文', () => {
    for (const channel of ['WECOM', 'SMS', 'EMAIL']) {
      process.env[`SMART_OFFICE_${channel}_ENABLED`] = 'true';
      process.env[`SMART_OFFICE_${channel}_URL`] = 'http://127.0.0.1:65534/unused';
    }
    const regular = externalNotificationEvents(notification, [user]);
    assert.deepEqual(regular.map(event => event.payload.channel).sort(), ['EMAIL', 'WECOM']);
    assert.ok(regular.every(event => !('content' in event.payload)));
    assert.equal(regular.find(event => event.payload.channel === 'WECOM')?.payload.recipient, 'HR-1001');
    assert.equal(regular.find(event => event.payload.channel === 'EMAIL')?.payload.recipient, 'user@example.com');

    const urgent = externalNotificationEvents({ ...notification, type: 'WARNING' }, [user]);
    assert.deepEqual(urgent.map(event => event.payload.channel).sort(), ['EMAIL', 'SMS', 'WECOM']);
    assert.equal(urgent.find(event => event.payload.channel === 'SMS')?.payload.recipient, '13800000000');
    assert.equal(urgent.find(event => event.payload.channel === 'SMS')?.key, 'external-notification:SMS:notice-1');
    assert.deepEqual(externalNotificationEvents(notification, [{ ...user, status: 'DISABLED' }]), []);
  });
});
