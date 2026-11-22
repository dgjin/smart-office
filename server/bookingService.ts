import type { Booking, BookingQuotaDetail, BookingRuleSettings, BookingServiceRequirement, Resource, User } from '../types.ts';
import { isServiceType } from '../constants.ts';
import {
  bookingDateKey,
  bookingLocalTime,
  findAttendeeOverlaps,
  findBookingConflicts,
  findRequesterConflicts,
  isValidBookingPurpose,
  splitBookingByNaturalDay,
  validateBookingResource
} from '../utils/bookingRules.ts';
import type { OfficeDb } from './tools.ts';
import { freezeServiceRequirements } from './serviceDomain.ts';

export class BookingRuleError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, status = 409, details?: unknown) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type ValidationInput = {
  db: OfficeDb;
  incoming: Booking[];
  requester: User;
  settings: BookingRuleSettings;
  ruleVersion: number;
  editingId?: string;
  now?: Date;
};

const phonePatterns = {
  landline: /^[0-9+()\- ]{5,24}$/,
  mobile: /^1\d{10}$/
};

const contactSnapshot = (requester: User) => {
  const landline = requester.landline?.trim() || '';
  const mobile = requester.mobile?.trim() || '';
  if (!requester.name || !phonePatterns.landline.test(landline) || !phonePatterns.mobile.test(mobile)) {
    throw new BookingRuleError('CONTACT_SNAPSHOT_INCOMPLETE', 400);
  }
  return { userId: requester.id, name: requester.name, landline, mobile };
};

const serviceRequirements = (booking: Booking): BookingServiceRequirement[] => {
  const supplied = booking.serviceRequirements || [];
  if (!Array.isArray(supplied) || supplied.length > 20) throw new BookingRuleError('INVALID_SERVICE_REQUIREMENTS', 400);
  const normalized = supplied.map(requirement => {
    if (!requirement || !isServiceType(requirement.type)
      || (requirement.fieldValues !== undefined && (!requirement.fieldValues || typeof requirement.fieldValues !== 'object' || Array.isArray(requirement.fieldValues)))) {
      throw new BookingRuleError('INVALID_SERVICE_REQUIREMENTS', 400);
    }
    const details = requirement.details?.trim();
    if (details && details.length > 500) throw new BookingRuleError('INVALID_SERVICE_REQUIREMENTS', 400);
    if (requirement.type === 'OTHER' && !details && !requirement.fieldValues?.notes?.trim()) throw new BookingRuleError('SERVICE_DETAILS_REQUIRED', 400);
    return {
      type: requirement.type,
      ...(details ? { details } : {}),
      ...(requirement.fieldValues ? { fieldValues: { ...requirement.fieldValues } } : {})
    };
  });
  if (new Set(normalized.map(item => item.type)).size !== normalized.length) throw new BookingRuleError('DUPLICATE_SERVICE_REQUIREMENT', 400);
  if (booking.needsTeaService && !normalized.some(item => item.type === 'TEA')) normalized.push({ type: 'TEA' });
  if (booking.isVideoConference && !normalized.some(item => item.type === 'VIDEO')) normalized.push({ type: 'VIDEO' });
  return normalized;
};

const assertMeetingAttributes = (booking: Booking) => {
  if (!isValidBookingPurpose(booking.purpose)) throw new BookingRuleError('INVALID_BOOKING_PURPOSE', 400);
  if (!['NORMAL', 'IMPORTANT', 'CONFIDENTIAL'].includes(booking.meetingType || '')) {
    throw new BookingRuleError('MEETING_TYPE_REQUIRED', 400);
  }
  if (!['NON_CONFIDENTIAL', 'CONFIDENTIAL'].includes(booking.confidentialityChoice || '')) {
    throw new BookingRuleError('CONFIDENTIALITY_CHOICE_REQUIRED', 400);
  }
  const confidential = booking.meetingType === 'CONFIDENTIAL';
  if ((booking.confidentialityChoice === 'CONFIDENTIAL') !== confidential) {
    throw new BookingRuleError('CONFIDENTIALITY_TYPE_MISMATCH', 400);
  }
};

const assertOpenHours = (resource: Resource, booking: Booking) => {
  if (!resource.openStart || !resource.openEnd) return;
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const lastInstant = new Date(end.getTime() - 1);
  if (bookingDateKey(start) !== bookingDateKey(lastInstant)
    || bookingLocalTime(start) < resource.openStart
    || bookingLocalTime(end) > resource.openEnd) {
    throw new BookingRuleError('RESOURCE_OUTSIDE_OPEN_HOURS', 409, {
      openStart: resource.openStart,
      openEnd: resource.openEnd
    });
  }
};

const assertExclusiveAccess = (resource: Resource, booking: Booking, settings: BookingRuleSettings, now: Date) => {
  if (!resource.isExclusive) return { exclusiveRequestReason: undefined, exclusiveAccessType: undefined };
  if (booking.hasLeader !== true) throw new BookingRuleError('EXCLUSIVE_LEADER_REQUIRED', 400);
  const leadTimeMs = new Date(booking.startTime).getTime() - now.getTime();
  if (leadTimeMs > settings.exclusiveRequestOpenHours * 3600000) {
    throw new BookingRuleError('EXCLUSIVE_REQUEST_WINDOW_CLOSED', 409, {
      opensAt: new Date(new Date(booking.startTime).getTime() - settings.exclusiveRequestOpenHours * 3600000).toISOString()
    });
  }
  const reason = booking.exclusiveRequestReason?.trim();
  if (!reason || reason.length < 2 || reason.length > 500) throw new BookingRuleError('EXCLUSIVE_REQUEST_REASON_REQUIRED', 400);
  return { exclusiveRequestReason: reason, exclusiveAccessType: 'TEMPORARY' as const };
};

const assertAuditoriumSetup = (resource: Resource, booking: Booking) => {
  if (resource.roomCategory !== 'AUDITORIUM') return undefined;
  const setup = booking.auditoriumSetup;
  if (!setup || !['THEATER', 'CLASSROOM', 'ROUNDTABLE'].includes(setup.seatingLayout) || typeof setup.stageRequired !== 'boolean') {
    throw new BookingRuleError('AUDITORIUM_SETUP_REQUIRED', 400);
  }
  if (setup.rehearsalMinutes !== undefined && (!Number.isInteger(setup.rehearsalMinutes) || setup.rehearsalMinutes < 0 || setup.rehearsalMinutes > 1440)) {
    throw new BookingRuleError('INVALID_AUDITORIUM_REHEARSAL', 400);
  }
  if (setup.notes && setup.notes.length > 500) throw new BookingRuleError('INVALID_AUDITORIUM_NOTES', 400);
  return { ...setup, notes: setup.notes?.trim() || undefined };
};

const departmentIdFor = (booking: Booking, db: OfficeDb) => {
  if (booking.requesterDepartmentId) return booking.requesterDepartmentId;
  const requester = (db.users || []).find(user => user.id === booking.userId);
  return (db.departments || []).find(department => department.name === requester?.department)?.id;
};

const countsForQuota = (booking: Booking) => ['PENDING', 'APPROVED', 'COMPLETED'].includes(booking.status);

export const buildBookingQuotaDetails = (
  db: OfficeDb,
  booking: Booking,
  settings: BookingRuleSettings,
  accepted: Booking[] = [],
  editingId?: string
): BookingQuotaDetail[] => {
  const departmentId = departmentIdFor(booking, db);
  if (!departmentId) throw new BookingRuleError('REQUESTER_DEPARTMENT_NOT_FOUND', 400);
  const occupied = [...(db.bookings || []), ...accepted].filter(item => item.id !== editingId
    && item.resourceId === booking.resourceId && departmentIdFor(item, db) === departmentId && countsForQuota(item));
  return splitBookingByNaturalDay(booking.startTime, booking.endTime).map(segment => {
    const usedBeforeMinutes = occupied.reduce((total, item) => total + splitBookingByNaturalDay(item.startTime, item.endTime)
      .filter(day => day.date === segment.date)
      .reduce((sum, day) => sum + day.minutes, 0), 0);
    const remainingMinutes = settings.departmentDailyNetMinutes - usedBeforeMinutes - segment.minutes;
    const detail = {
      resourceId: booking.resourceId,
      date: segment.date,
      limitMinutes: settings.departmentDailyNetMinutes,
      usedBeforeMinutes,
      requestedMinutes: segment.minutes,
      remainingMinutes
    };
    if (remainingMinutes < 0) throw new BookingRuleError('DEPARTMENT_DAILY_QUOTA_EXCEEDED', 409, { departmentId, quota: detail });
    return detail;
  });
};

export const validateBookingBatch = ({ db, incoming, requester, settings, ruleVersion, editingId, now = new Date() }: ValidationInput) => {
  if (new Set(incoming.map(booking => booking.resourceId)).size > 1) {
    throw new BookingRuleError('MULTI_RESOURCE_BOOKING_NOT_SUPPORTED', 400);
  }
  const accepted: Booking[] = [];
  const contact = contactSnapshot(requester);
  for (const [index, candidate] of incoming.entries()) {
    assertMeetingAttributes(candidate);
    const resource = (db.resources || []).find(item => item.id === candidate.resourceId);
    const resourceError = validateBookingResource(resource, candidate);
    if (resourceError) {
      const status = resourceError === 'RESOURCE_NOT_FOUND' ? 404 : ['INVALID_TIME_RANGE', 'INVALID_PARTICIPANTS'].includes(resourceError) ? 400 : 409;
      throw new BookingRuleError(resourceError, status);
    }
    if (!resource) throw new BookingRuleError('RESOURCE_NOT_FOUND', 404);
    if (new Date(candidate.startTime).getTime() <= now.getTime()) throw new BookingRuleError('BOOKING_START_IN_PAST', 400);
    assertOpenHours(resource, candidate);

    const services = freezeServiceRequirements(db, serviceRequirements(candidate), resource);
    const booking: Booking = {
      ...candidate,
      overlapParticipantIds: undefined,
      securityAuthorizationIds: undefined,
      purpose: candidate.purpose.trim(),
      contactSnapshot: contact,
      serviceRequirements: services,
      needsTeaService: services.some(item => item.type === 'TEA'),
      isVideoConference: services.some(item => item.type === 'VIDEO'),
      auditoriumSetup: assertAuditoriumSetup(resource, candidate),
      ...assertExclusiveAccess(resource, candidate, settings, now),
      ruleVersion,
      ruleSettingsSnapshot: structuredClone(settings)
    };
    const resourceConflicts = findBookingConflicts([...(db.bookings || []), ...accepted], booking, editingId);
    if (resourceConflicts.length) throw new BookingRuleError('CONFLICT', 409, [{ index, conflicts: resourceConflicts }]);
    const requesterConflicts = findRequesterConflicts([...(db.bookings || []), ...accepted], booking, editingId);
    if (requesterConflicts.length) {
      throw new BookingRuleError('REQUESTER_TIME_CONFLICT', 409, { index, bookingIds: requesterConflicts.map(item => item.id) });
    }
    const attendeeOverlaps = findAttendeeOverlaps(db.bookings || [], booking, editingId);
    booking.attendeeWarnings = attendeeOverlaps.flatMap(overlap => (booking.attendeeIds || [])
      .filter(id => overlap.attendeeIds?.includes(id) || overlap.userId === id)
      .map(id => {
        const attendee = (db.users || []).find(user => user.id === id);
        return `${attendee?.name || '参会人'}在该时段已有其他预约`;
      }));
    booking.attendeeWarnings = [...new Set(booking.attendeeWarnings)];
    booking.quotaDetails = buildBookingQuotaDetails(db, booking, settings, accepted, editingId);
    accepted.push(booking);
  }
  return accepted;
};
