import { getDbPool } from './db.ts';
import { HttpError } from './http.ts';

const ACTION_TYPES = new Set(['PROPOSE_BOOKING', 'PROPOSE_CANCEL', 'PROPOSE_APPROVAL', 'PROPOSE_CHECK_IN', 'PROPOSE_WORK_ORDER', 'NAVIGATE', 'REFRESH']);
const ACTION_STATES = new Set(['done', 'opened', 'dismissed']);

const invalid = (): never => { throw new HttpError(400, 'INVALID_CONVERSATION'); };
const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : invalid();
const text = (value: any, max: number, optional = false) => {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) invalid();
  return value;
};
const boolean = (value: any) => value === undefined ? undefined : typeof value === 'boolean' ? value : invalid();
const stringList = (value: any, maxItems: number, maxLength: number) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) invalid();
  return value.map(item => text(item, maxLength));
};

const sanitizeDraft = (value: any) => {
  const draft = record(value);
  if (!draft.resourceId || !draft.startTime || !draft.endTime || !Number.isFinite(Date.parse(draft.startTime)) || !Number.isFinite(Date.parse(draft.endTime))) invalid();
  if (draft.type !== undefined && !['ROOM', 'DESK'].includes(draft.type)) invalid();
  if (draft.participants !== undefined && (!Number.isInteger(draft.participants) || draft.participants < 1 || draft.participants > 10000)) invalid();
  if (draft.meetingType !== undefined && !['NORMAL', 'IMPORTANT'].includes(draft.meetingType)) invalid();
  let recurrence;
  if (draft.recurrence !== undefined) {
    const value = record(draft.recurrence);
    if (!['WEEKLY', 'BIWEEKLY'].includes(value.frequency) || !Number.isInteger(value.count) || value.count < 2 || value.count > 52) invalid();
    recurrence = { frequency: value.frequency, count: value.count };
  }
  let serviceRequirements;
  if (draft.serviceRequirements !== undefined) {
    if (!Array.isArray(draft.serviceRequirements) || draft.serviceRequirements.length > 20) invalid();
    serviceRequirements = draft.serviceRequirements.map((value: any) => {
      const requirement = record(value);
      if (!['TEA', 'VIDEO', 'SIGNAGE', 'SECURITY', 'OTHER'].includes(requirement.type)) invalid();
      return { type: requirement.type, details: text(requirement.details, 500, true) };
    });
  }
  let auditoriumSetup;
  if (draft.auditoriumSetup !== undefined) {
    const setup = record(draft.auditoriumSetup);
    if (!['THEATER', 'CLASSROOM', 'ROUNDTABLE'].includes(setup.seatingLayout)
      || typeof setup.stageRequired !== 'boolean'
      || (setup.rehearsalMinutes !== undefined && (!Number.isInteger(setup.rehearsalMinutes) || setup.rehearsalMinutes < 0 || setup.rehearsalMinutes > 1440))) invalid();
    auditoriumSetup = {
      seatingLayout: setup.seatingLayout,
      stageRequired: setup.stageRequired,
      rehearsalMinutes: setup.rehearsalMinutes,
      notes: text(setup.notes, 500, true)
    };
  }
  return {
    resourceId: text(draft.resourceId, 128),
    type: draft.type,
    startTime: text(draft.startTime, 64),
    endTime: text(draft.endTime, 64),
    purpose: text(draft.purpose, 2000),
    participants: draft.participants,
    needsTeaService: boolean(draft.needsTeaService),
    isVideoConference: boolean(draft.isVideoConference),
    requiredFeatures: stringList(draft.requiredFeatures, 32, 64),
    attendeeIds: stringList(draft.attendeeIds, 200, 128),
    hasLeader: boolean(draft.hasLeader),
    leaderDetails: text(draft.leaderDetails, 1000, true),
    meetingType: draft.meetingType,
    serviceRequirements,
    exclusiveRequestReason: text(draft.exclusiveRequestReason, 500, true),
    auditoriumSetup,
    recurrence
  };
};

const sanitizeAction = (value: any) => {
  const action = record(value);
  if (!ACTION_TYPES.has(action.type)) invalid();
  if (action.decision !== undefined && !['APPROVE', 'REJECT'].includes(action.decision)) invalid();
  return {
    type: action.type,
    draft: action.draft === undefined ? undefined : sanitizeDraft(action.draft),
    summary: text(action.summary, 4000, true),
    bookingId: text(action.bookingId, 128, true),
    bookingIds: stringList(action.bookingIds, 100, 128),
    workOrderId: text(action.workOrderId, 128, true),
    decision: action.decision,
    comment: text(action.comment, 4000, true),
    view: text(action.view, 64, true)
  };
};

const sanitizeTurn = (value: any) => {
  const turn = record(value);
  if (!['user', 'assistant'].includes(turn.role)) invalid();
  if (turn.actions !== undefined && (!Array.isArray(turn.actions) || turn.actions.length > 20)) invalid();
  if (turn.trace !== undefined && (!Array.isArray(turn.trace) || turn.trace.length > 50)) invalid();
  return {
    role: turn.role,
    content: text(turn.content, 20000),
    actions: turn.actions?.map(sanitizeAction),
    trace: turn.trace?.map((value: any) => {
      const entry = record(value);
      if (typeof entry.ok !== 'boolean' || typeof entry.ms !== 'number' || !Number.isFinite(entry.ms) || entry.ms < 0) invalid();
      return { tool: text(entry.tool, 128), ok: entry.ok, ms: entry.ms, error: text(entry.error, 2000, true) };
    }),
    failed: boolean(turn.failed)
  };
};

const sanitizeState = (value: any) => {
  const state = record(value);
  if (!Array.isArray(state.turns) || state.turns.length > 100 || typeof state.input !== 'string' || state.input.length > 4000) invalid();
  const handled = record(state.handled);
  const entries = Object.entries(handled);
  if (entries.length > 500) invalid();
  return {
    turns: state.turns.map(sanitizeTurn),
    handled: Object.fromEntries(entries.map(([key, value]) => {
      if (key.length > 160 || !ACTION_STATES.has(String(value))) invalid();
      return [key, value];
    })),
    input: state.input
  };
};

const emptyState = () => ({ turns: [], handled: {}, input: '' });
const parsePayload = (value: any) => sanitizeState(typeof value === 'string' ? JSON.parse(value) : value);

export const getChatConversation = async (userId: string) => {
  const [rows] = await getDbPool().query<any[]>('SELECT revision, payload, updated_at FROM chatdock_conversations WHERE user_id = ?', [userId]);
  const row = rows[0];
  return {
    revision: Number(row?.revision || 0),
    state: row ? parsePayload(row.payload) : emptyState(),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
  };
};

export const saveChatConversation = async (userId: string, input: any) => {
  const body = record(input);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new HttpError(400, 'INVALID_CONVERSATION_REVISION');
  const state = sanitizeState(body.state);
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>('SELECT revision FROM chatdock_conversations WHERE user_id = ? FOR UPDATE', [userId]);
    const currentRevision = Number(rows[0]?.revision || 0);
    if (currentRevision !== body.revision) throw new HttpError(409, 'CONVERSATION_CONFLICT');
    const revision = currentRevision + 1;
    if (rows.length) {
      await conn.query('UPDATE chatdock_conversations SET revision = ?, payload = ? WHERE user_id = ?', [revision, JSON.stringify(state), userId]);
    } else {
      await conn.query('INSERT INTO chatdock_conversations (user_id, revision, payload) VALUES (?, ?, ?)', [userId, revision, JSON.stringify(state)]);
    }
    await conn.commit();
    return { revision, state };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};
