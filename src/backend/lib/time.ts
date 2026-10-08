// Utilitários de horário de operação (fuso configurável).
import { config } from '../config.js';

export function localParts(date = new Date(), timeZone = config.queue.timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[parts.weekday as string] ?? 0,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isWithinWindow(
  windowStart: string,
  windowEnd: string,
  weekdays: number[],
  date = new Date(),
): boolean {
  const { weekday, minutes } = localParts(date);
  if (weekdays.length && !weekdays.includes(weekday)) return false;
  const start = hhmmToMinutes(windowStart);
  const end = hhmmToMinutes(windowEnd);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Início do dia local corrente em UTC (para contadores diários). */
export function startOfLocalDay(date = new Date()): Date {
  const { minutes } = localParts(date);
  const d = new Date(date.getTime() - minutes * 60000);
  d.setUTCSeconds(0, 0);
  return d;
}
