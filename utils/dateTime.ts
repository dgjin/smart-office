import type { Booking } from '../types';

export const pad2 = (value: number) => value.toString().padStart(2, '0');

export const formatTime = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

export const formatDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const toLocalDateTimeString = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${formatDate(date)} ${formatTime(date)}`;
};

export const toLocalTimeString = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatTime(date);
};

export const toLocalDateString = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDate(date);
};

export const normalizeIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

export const migrateBookings = (list: any[] = []): Booking[] => list.map(booking => ({
  ...booking,
  startTime: normalizeIso(booking.startTime),
  endTime: normalizeIso(booking.endTime)
}));
