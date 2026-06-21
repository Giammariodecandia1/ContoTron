import { format, parseISO, startOfMonth, endOfMonth, getDaysInMonth, differenceInDays } from 'date-fns';
import { it } from 'date-fns/locale';

export function formatDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
  return format(date, 'dd MMM yyyy', { locale: it });
}

export function getMonthBoundaries(year: number, month: number) {
  // Note: month is 1-12, Date uses 0-11
  const date = new Date(year, month - 1, 1);
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
    daysInMonth: getDaysInMonth(date)
  };
}

export function getDaysPassedInMonth(currentDate: Date = new Date()): number {
  const start = startOfMonth(currentDate);
  // differenceInDays counts full days passed. +1 so on 1st it's 1 day.
  return differenceInDays(currentDate, start) + 1;
}

export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
