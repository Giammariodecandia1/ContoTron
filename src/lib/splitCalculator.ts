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
