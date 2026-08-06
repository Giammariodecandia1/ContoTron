import type { TransactionType } from '../types/database';

export interface MemberIdentity {
  userId: string;
  displayName: string;
  email: string | null;
}

export interface MemberTransactionSummary extends MemberIdentity {
  transactionCount: number;
  expenses: number;
  income: number;
}

interface SummaryTransaction {
  inserted_by: string | null;
  type: TransactionType;
  amount: number;
  inserted_by_profile?: { display_name?: string | null; email?: string | null } | null;
}

export const unattributedMemberId = 'unattributed';

export const summarizeTransactionsByMember = (
  members: MemberIdentity[],
  transactions: SummaryTransaction[],
): MemberTransactionSummary[] => {
  const summaryByMember = new Map<string, MemberTransactionSummary>();

  members.forEach(member => {
    summaryByMember.set(member.userId, {
      ...member,
      transactionCount: 0,
      expenses: 0,
      income: 0,
    });
  });

  transactions.forEach(transaction => {
    const memberId = transaction.inserted_by || unattributedMemberId;
    if (!summaryByMember.has(memberId)) {
      const profile = transaction.inserted_by_profile;
      summaryByMember.set(memberId, {
        userId: memberId,
        displayName: memberId === unattributedMemberId
          ? 'Non attribuite'
          : profile?.display_name || profile?.email || 'Componente precedente',
        email: profile?.email || null,
        transactionCount: 0,
        expenses: 0,
        income: 0,
      });
    }

    const summary = summaryByMember.get(memberId);
    if (!summary) return;
    summary.transactionCount += 1;
    if (transaction.type === 'expense') summary.expenses += Number(transaction.amount || 0);
    if (transaction.type === 'income') summary.income += Number(transaction.amount || 0);
  });

  return Array.from(summaryByMember.values()).sort((left, right) => {
    if (left.userId === unattributedMemberId) return 1;
    if (right.userId === unattributedMemberId) return -1;
    return left.displayName.localeCompare(right.displayName, 'it');
  });
};
