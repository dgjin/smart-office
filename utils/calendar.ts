import type { Booking, Resource, User } from '../types';

const encoder = new TextEncoder();

const byteLength = (value: string) => encoder.encode(value).length;

const foldLine = (line: string): string => {
  let output = '';
  let current = '';
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = byteLength(character);
    if (current && currentBytes + characterBytes > 75) {
      output += `${current}\r\n`;
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }
  return output + current;
};

export const escapeCalendarText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/\r\n|\r|\n/g, '\\n')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,');

export const escapeCalendarParameter = (value: string): string => `"${value
  .replace(/\^/g, '^^')
  .replace(/\r\n|\r|\n/g, '^n')
  .replace(/"/g, "^'")}"`;

const calendarTimestamp = (value: Date | string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Calendar dates must be valid');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

const calendarAddress = (email: string): string => email.replace(/[\r\n]/g, character =>
  character === '\r' ? '%0D' : '%0A'
);

export const generateBookingIcs = (
  booking: Booking,
  resource: Resource,
  users: User[],
  now: Date | string
): string => {
  if (booking.status !== 'APPROVED' && booking.status !== 'CANCELLED') {
    throw new RangeError('Only approved or cancelled bookings can be exported');
  }
  const startTime = calendarTimestamp(booking.startTime);
  const endTime = calendarTimestamp(booking.endTime);
  if (new Date(booking.endTime).getTime() <= new Date(booking.startTime).getTime()) {
    throw new RangeError('Booking end must be after its start');
  }

  const organizer = users.find(user => user.id === booking.userId);
  const attendees = (booking.attendeeIds || [])
    .map(id => users.find(user => user.id === id))
    .filter((user): user is User => user !== undefined);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartOffice//Booking//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeCalendarText(`${booking.id}@smartoffice.local`)}`,
    `DTSTAMP:${calendarTimestamp(now)}`,
    `DTSTART:${startTime}`,
    `DTEND:${endTime}`,
    `SUMMARY:${escapeCalendarText(booking.purpose)}`,
    `LOCATION:${escapeCalendarText(resource.name)}`,
    ...(organizer
      ? [`ORGANIZER;CN=${escapeCalendarParameter(organizer.name)}:MAILTO:${calendarAddress(organizer.email)}`]
      : []),
    ...attendees.map(user => `ATTENDEE;CN=${escapeCalendarParameter(user.name)};RSVP=TRUE:MAILTO:${calendarAddress(user.email)}`),
    `STATUS:${booking.status === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED'}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
};
