export interface SplitParticipantInput {
  userId: string;
  displayName: string;
}

export interface SplitPaymentInput {
  userId: string;
  amountCents: number;
}

export interface SplitBalance {
  userId: string;
  displayName: string;
  paidCents: number;
  shareCents: number;
  balanceCents: number;
  transactionCount: number;
  percentage: number;
}

export interface SplitSettlement {
  fromUserId: string;
  from: string;
  toUserId: string;
  to: string;
  amountCents: number;
}

export interface SplitEligibleTransaction {
  type: string;
  status: string;
  is_shared: boolean;
}

export interface SplitMonthlyAllocationInput {
  amount: number;
  transaction_date: string;
  cash_impact_date?: string | null;
  split_months?: number | null;
}

export interface SplitMonthlyAllocation {
  allocationDate: string;
  amountCents: number;
  installmentNumber: number;
  installmentCount: number;
}

const isoDate = (year: number, monthIndex: number, day: number) => (
  `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const addMonthsClamped = (dateIso: string, monthOffset: number) => {
  const [year, month, day] = dateIso.split('-').map(Number);
  const target = new Date(year, month - 1 + monthOffset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return isoDate(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
};

export const allocateTransactionAcrossSplitMonths = (
  transaction: SplitMonthlyAllocationInput,
): SplitMonthlyAllocation[] => {
  const requestedMonths = Math.trunc(Number(transaction.split_months || 1));
  const installmentCount = Math.min(120, Math.max(1, Number.isFinite(requestedMonths) ? requestedMonths : 1));
  const totalCents = Math.round(Number(transaction.amount || 0) * 100);
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainderCents = totalCents % installmentCount;
  const startDate = transaction.cash_impact_date || transaction.transaction_date;

  return Array.from({ length: installmentCount }, (_, index) => ({
    allocationDate: addMonthsClamped(startDate, index),
    amountCents: baseCents + (index < remainderCents ? 1 : 0),
    installmentNumber: index + 1,
    installmentCount,
  }));
};

export const transactionBelongsToSplit = (transaction: SplitEligibleTransaction) => (
  transaction.type === 'expense'
  && transaction.status !== 'deleted'
  && transaction.status !== 'rejected'
  && transaction.is_shared !== false
);

export const calculateEqualSplit = (
  participants: SplitParticipantInput[],
  payments: SplitPaymentInput[],
) => {
  const totalCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const baseShareCents = participants.length > 0 ? Math.floor(totalCents / participants.length) : 0;
  const remainderCents = participants.length > 0 ? totalCents % participants.length : 0;
  const balances: SplitBalance[] = participants.map((participant, index) => {
    const memberPayments = payments.filter(payment => payment.userId === participant.userId);
    const paidCents = memberPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const shareCents = baseShareCents + (index < remainderCents ? 1 : 0);
    return {
      ...participant,
      paidCents,
      shareCents,
      balanceCents: paidCents - shareCents,
      transactionCount: memberPayments.length,
      percentage: totalCents > 0 ? paidCents / totalCents * 100 : 0,
    };
  });
  const debtors = balances
    .filter(row => row.balanceCents < 0)
    .map(row => ({ userId: row.userId, name: row.displayName, cents: -row.balanceCents }))
    .sort((left, right) => right.cents - left.cents);
  const creditors = balances
    .filter(row => row.balanceCents > 0)
    .map(row => ({ userId: row.userId, name: row.displayName, cents: row.balanceCents }))
    .sort((left, right) => right.cents - left.cents);
  const settlements: SplitSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.cents, creditor.cents);

    if (amountCents > 0) {
      settlements.push({
        fromUserId: debtor.userId,
        from: debtor.name,
        toUserId: creditor.userId,
        to: creditor.name,
        amountCents,
      });
      debtor.cents -= amountCents;
      creditor.cents -= amountCents;
    }

    if (debtor.cents === 0) debtorIndex += 1;
    if (creditor.cents === 0) creditorIndex += 1;
  }

  return { totalCents, balances, settlements };
};
