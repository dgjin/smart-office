import type { Notification, User } from '../types.ts';
import { IS_PRODUCTION } from './config.ts';

export type ExternalMessageChannel = 'WECOM' | 'SMS' | 'EMAIL';

export type ExternalNotificationPayload = {
  notificationId: string;
  channel: ExternalMessageChannel;
  recipient: string;
  title: string;
  occurredAt: string;
};

type ChannelConfig = {
  enabled: boolean;
  endpoint: string;
  authToken: string;
};

const channelConfig = (channel: ExternalMessageChannel): ChannelConfig => {
  const prefix = `SMART_OFFICE_${channel}`;
  return {
    enabled: process.env[`${prefix}_ENABLED`] === 'true',
    endpoint: process.env[`${prefix}_URL`] || '',
    authToken: process.env[`${prefix}_AUTH_TOKEN`] || ''
  };
};

const timeoutMs = () => {
  const configured = Number(process.env.SMART_OFFICE_EXTERNAL_HTTP_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured >= 100 && configured <= 30000 ? configured : 5000;
};

const recipientFor = (channel: ExternalMessageChannel, user: User) => {
  if (channel === 'WECOM') return user.externalId || user.id;
  if (channel === 'SMS') return user.mobile?.trim() || '';
  return user.email.trim();
};

export const externalNotificationEvents = (notification: Notification, users: User[]) => {
  const user = users.find(item => item.id === notification.userId && item.status !== 'DISABLED');
  if (!user) return [];
  const channels: ExternalMessageChannel[] = ['WECOM', 'EMAIL'];
  if (notification.type === 'WARNING') channels.push('SMS');
  return channels.flatMap(channel => {
    if (!channelConfig(channel).enabled) return [];
    const recipient = recipientFor(channel, user);
    if (!recipient) return [];
    const payload: ExternalNotificationPayload = {
      notificationId: notification.id,
      channel,
      recipient,
      title: notification.title,
      occurredAt: notification.timestamp
    };
    return [{
      key: `external-notification:${channel}:${notification.id}`,
      type: 'EXTERNAL_NOTIFICATION',
      payload
    }];
  });
};

const validPayload = (value: any): ExternalNotificationPayload => {
  if (!value || !['WECOM', 'SMS', 'EMAIL'].includes(value.channel)
    || typeof value.notificationId !== 'string' || !value.notificationId || value.notificationId.length > 128
    || typeof value.recipient !== 'string' || !value.recipient || value.recipient.length > 255
    || typeof value.title !== 'string' || !value.title || value.title.length > 255
    || typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) {
    throw new Error('EXTERNAL_DELIVERY_PAYLOAD_INVALID');
  }
  return {
    notificationId: value.notificationId,
    channel: value.channel,
    recipient: value.recipient,
    title: value.title,
    occurredAt: value.occurredAt
  };
};

const deliveryEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (IS_PRODUCTION && url.protocol !== 'https:')) throw new Error();
    return url;
  } catch {
    throw new Error('EXTERNAL_DELIVERY_CONFIG_INVALID');
  }
};

export const deliverExternalNotification = async (input: unknown, idempotencyKey: string) => {
  const payload = validPayload(input);
  const config = channelConfig(payload.channel);
  if (!config.enabled) return { outcome: 'SKIPPED' as const, reason: 'DISABLED' };
  const endpoint = deliveryEndpoint(config.endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {})
      },
      body: JSON.stringify({
        messageId: payload.notificationId,
        channel: payload.channel,
        recipient: payload.recipient,
        title: payload.title,
        content: `您有一条「${payload.title}」提醒，请登录智慧办公系统查看详情。`,
        occurredAt: payload.occurredAt
      }),
      signal: controller.signal
    });
    const status = response.status;
    await response.body?.cancel();
    if (status < 200 || status >= 300) throw new Error(`EXTERNAL_DELIVERY_HTTP_${status}`);
    return { outcome: 'DELIVERED' as const, status };
  } catch (error) {
    if (error instanceof Error && /^EXTERNAL_DELIVERY_HTTP_\d{3}$/.test(error.message)) throw error;
    if (controller.signal.aborted) throw new Error('EXTERNAL_DELIVERY_TIMEOUT');
    throw new Error('EXTERNAL_DELIVERY_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
};
