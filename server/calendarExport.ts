import { generateBookingIcs } from '../utils/calendar.ts';
import type { User } from '../types.ts';
import { recordAudit } from './audit.ts';
import { canReadBookingDetails, getActorDbView, isConfidentialBooking } from './confidentiality.ts';
import { readDb } from './db.ts';
import { HttpError } from './http.ts';

export const exportBookingIcs = async (actor: User, bookingId: string) => {
  const db = await readDb();
  const original = (db.bookings || []).find(booking => booking.id === bookingId);
  if (!original) throw new HttpError(404, 'BOOKING_NOT_FOUND');
  if (isConfidentialBooking(original) && !canReadBookingDetails(db, original, actor)) {
    throw new HttpError(403, 'CONFIDENTIAL_EXPORT_FORBIDDEN');
  }
  const view = getActorDbView(db, actor);
  const booking = (view.bookings || []).find(item => item.id === bookingId)!;
  const resource = (db.resources || []).find(item => item.id === booking.resourceId);
  if (!resource) throw new HttpError(404, 'RESOURCE_NOT_FOUND');
  const ics = generateBookingIcs(booking, resource, view.users || [], new Date());
  await recordAudit({
    actorId: actor.id,
    action: isConfidentialBooking(original) ? 'CONFIDENTIAL_EXPORT' : 'BOOKING_ICS_EXPORT',
    entityType: 'BOOKING',
    entityId: bookingId,
    details: { format: 'ICS' }
  });
  return { ics, filename: `booking-${bookingId.replace(/[^A-Za-z0-9._-]/g, '_')}.ics` };
};
