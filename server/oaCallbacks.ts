import crypto from 'node:crypto';
import type { ExternalCallback } from '../types.ts';
import { applyApprovalDecision } from './approvalDomain.ts';
import { mutateDb } from './db.ts';
import { HttpError } from './http.ts';

const callbackSecret = () => process.env.SMART_OFFICE_OA_CALLBACK_SECRET || '';
const text = (value: unknown, max = 128, min = 1) => typeof value === 'string' && value.length >= min && value.length <= max;

const verifySignature = (raw: string, signature: string) => {
  const expected = crypto.createHmac('sha256', callbackSecret()).update(raw, 'utf8').digest();
  const suppliedText = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  if (!/^[a-f0-9]{64}$/i.test(suppliedText)) throw new HttpError(401, 'OA_SIGNATURE_INVALID');
  const supplied = Buffer.from(suppliedText, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new HttpError(401, 'OA_SIGNATURE_INVALID');
};

const businessErrorCode = (error: any) => {
  if (error?.code && typeof error.code === 'string') return error.code.slice(0, 100);
  if (error?.status === 403) return 'OA_APPROVER_FORBIDDEN';
  if (error?.status === 409) return 'OA_BOOKING_STATE_CHANGED';
  if (error?.status === 400) return 'OA_DECISION_INVALID';
  return 'OA_APPROVAL_REJECTED';
};

export const handleOaCallback = async (raw: string, signature: unknown) => {
  if (process.env.SMART_OFFICE_OA_CALLBACK_ENABLED !== 'true') throw new HttpError(503, 'OA_CALLBACK_DISABLED');
  if (!callbackSecret()) throw new HttpError(503, 'OA_CALLBACK_NOT_CONFIGURED');
  verifySignature(raw, String(signature || ''));
  let input: any;
  try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'INVALID_JSON'); }
  if (!input || !text(input.eventId, 128, 8) || !text(input.nonce, 128, 8)
    || !text(input.bookingId) || !text(input.externalApprovalId) || !text(input.approverExternalId, 255)
    || !['APPROVE', 'REJECT'].includes(input.decision) || !validOccurredAt(input.occurredAt)
    || (input.comment !== undefined && (typeof input.comment !== 'string' || input.comment.length > 500))
    || (input.decision === 'REJECT' && !String(input.comment || '').trim())) {
    throw new HttpError(400, 'OA_CALLBACK_INVALID');
  }
  const payloadHash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const receivedAt = new Date().toISOString();
  const callback: ExternalCallback = {
    id: `oa:${input.eventId}`,
    source: 'OA',
    eventId: input.eventId,
    nonce: input.nonce,
    payloadHash,
    bookingId: input.bookingId,
    externalApprovalId: input.externalApprovalId,
    decision: input.decision,
    approverExternalId: input.approverExternalId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    receivedAt,
    status: 'REJECTED'
  };
  try {
    return await mutateDb(async (db, context) => {
      const existing = (db.externalCallbacks || []).find(item => item.eventId === input.eventId);
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.nonce !== input.nonce) throw new HttpError(409, 'OA_CALLBACK_CONFLICT');
        return { callback: existing, duplicate: true };
      }
      const approver = (db.users || []).find(user => user.externalId === input.approverExternalId && user.status !== 'DISABLED');
      if (!approver) throw new HttpError(403, 'OA_APPROVER_FORBIDDEN');
      const result = await applyApprovalDecision(db, approver, input, context);
      db.notifications = [...result.notifications, ...(db.notifications || [])].slice(0, 1000);
      const applied: ExternalCallback = { ...callback, status: 'APPLIED' };
      db.externalCallbacks = [applied, ...(db.externalCallbacks || [])].slice(0, 1000);
      await context.audit({
        actorId: approver.id, action: 'OA_CALLBACK_APPLIED', entityType: 'BOOKING', entityId: input.bookingId,
        details: { eventId: input.eventId, externalApprovalId: input.externalApprovalId, decision: input.decision }
      });
      return { callback: applied, duplicate: false };
    });
  } catch (error: any) {
    if (error instanceof HttpError && ['OA_CALLBACK_CONFLICT'].includes(error.code)) throw error;
    if (![400, 403, 409].includes(Number(error?.status))) throw error;
    return mutateDb(async (db, { audit }) => {
      const existing = (db.externalCallbacks || []).find(item => item.eventId === input.eventId);
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.nonce !== input.nonce) throw new HttpError(409, 'OA_CALLBACK_CONFLICT');
        return { callback: existing, duplicate: true };
      }
      const rejected: ExternalCallback = { ...callback, status: 'REJECTED', errorCode: businessErrorCode(error) };
      db.externalCallbacks = [rejected, ...(db.externalCallbacks || [])].slice(0, 1000);
      const approver = (db.users || []).find(user => user.externalId === input.approverExternalId);
      await audit({
        actorId: approver?.id, action: 'OA_CALLBACK_REJECTED', entityType: 'BOOKING', entityId: input.bookingId,
        details: { eventId: input.eventId, externalApprovalId: input.externalApprovalId, decision: input.decision, errorCode: rejected.errorCode }
      });
      return { callback: rejected, duplicate: false };
    });
  }
};

const validOccurredAt = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= 5 * 60000;
};
