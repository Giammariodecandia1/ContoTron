export type IncomeCadence = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly';
export type IncomeOccurrenceKind = 'regular' | 'thirteenth' | 'fourteenth';

export interface IncomeSourceSchedule {
  id: string;
  name: string;
  amount: number;
  payday: number;
  cadence: IncomeCadence;
  effective_from: string;
  effective_to: string | null;
  thirteenth_amount: number;
  thirteenth_month: number | null;
  fourteenth_amount: number;
  fourteenth_month: number | null;
}

export interface ScheduledIncome {
  key: string;
  incomeSourceId: string;
  name: string;
  date: string;
  month: number;
  amount: number;
  kind: IncomeOccurrenceKind;
}

const cadenceMonths: Record<IncomeCadence, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

const scheduleDate = (year: number, month: number, day: number) => {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
};

export const generateIncomeSchedule = (sources: IncomeSourceSchedule[], year: number): ScheduledIncome[] => {
  const results: ScheduledIncome[] = [];

  sources.forEach(source => {
    const fromMonth = Number(source.effective_from.slice(0, 7).replace('-', ''));
    const toDate = source.effective_to;
    const fromDate = source.effective_from;
    const cadence = cadenceMonths[source.cadence] || 1;

    for (let month = 1; month <= 12; month += 1) {
      const date = scheduleDate(year, month, source.payday);
      const monthIndex = year * 12 + month;
      const startIndex = Math.floor(fromMonth / 100) * 12 + (fromMonth % 100);
      const inValidity = date >= fromDate && (!toDate || date <= toDate);
      if (inValidity && monthIndex >= startIndex && (monthIndex - startIndex) % cadence === 0 && source.amount > 0) {
        results.push({
          key: `${source.id}:${date}:regular`,
          incomeSourceId: source.id,
          name: source.name,
          date,
          month,
          amount: Number(source.amount),
          kind: 'regular',
        });
      }

      const extras: Array<{ kind: 'thirteenth' | 'fourteenth'; month: number | null; amount: number }> = [
        { kind: 'thirteenth', month: source.thirteenth_month, amount: Number(source.thirteenth_amount || 0) },
        { kind: 'fourteenth', month: source.fourteenth_month, amount: Number(source.fourteenth_amount || 0) },
      ];
      extras.forEach(extra => {
        if (month !== extra.month || extra.amount <= 0 || !inValidity) return;
        results.push({
          key: `${source.id}:${date}:${extra.kind}`,
          incomeSourceId: source.id,
          name: source.name,
          date,
          month,
          amount: extra.amount,
          kind: extra.kind,
        });
      });
    }
  });

  return results.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name, 'it-IT'));
};
