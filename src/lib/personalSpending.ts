export interface PersonalSpendingTransaction {
  type: string;
  amount: number;
  status?: string | null;
  is_shared?: boolean | null;
  inserted_by?: string | null;
}

export interface PersonalSpendingSummary {
  participantCount: number;
  sharedExpenses: number;
  sharedQuota: number;
  personalExpenses: number;
  personalTotal: number;
}

/**
 * The monthly amount borne by a member: equal share of household expenses,
 * plus only their own purchases explicitly excluded from the family Split.
 */
export const calculatePersonalSpending = (
  transactions: PersonalSpendingTransaction[],
  userId?: string | null,
  participantCount = 1,
): PersonalSpendingSummary => {
  const safeParticipantCount = Math.max(1, participantCount);
  let sharedExpenses = 0;
  let personalExpenses = 0;

  transactions.forEach(transaction => {
    if (
      transaction.type !== 'expense'
      || transaction.status === 'deleted'
      || transaction.status === 'rejected'
    ) return;

    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return;

    if (transaction.is_shared !== false) {
      sharedExpenses += amount;
    } else if (userId && transaction.inserted_by === userId) {
      personalExpenses += amount;
    }
  });

  const sharedQuota = sharedExpenses / safeParticipantCount;
  return {
    participantCount: safeParticipantCount,
    sharedExpenses,
    sharedQuota,
    personalExpenses,
    personalTotal: sharedQuota + personalExpenses,
  };
};
