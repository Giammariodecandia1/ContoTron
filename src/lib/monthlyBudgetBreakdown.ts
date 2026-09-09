export type UnallocatedFixedRule = {
  id: string;
  description: string;
  amount: number;
};

const moneyDifference = (left: number, right: number) => (
  (Math.round(Number(left || 0) * 100) - Math.round(Number(right || 0) * 100)) / 100
);

export const calculateUnallocatedBudgetBreakdown = ({
  categoryBudget,
  unallocatedActual,
  fixedRules,
  actualByRecurringRule,
}: {
  categoryBudget: number;
  unallocatedActual: number;
  fixedRules: UnallocatedFixedRule[];
  actualByRecurringRule: Record<string, number>;
}) => {
  const fixedRows = fixedRules.map(rule => {
    const planned = Number(rule.amount || 0);
    const actual = Number(actualByRecurringRule[rule.id] || 0);
    return {
      id: rule.id,
      description: rule.description,
      planned,
      actual,
      difference: moneyDifference(planned, actual),
    };
  });
  const fixedPlanned = fixedRows.reduce((sum, row) => sum + row.planned, 0);
  const fixedActual = fixedRows.reduce((sum, row) => sum + row.actual, 0);

  return {
    fixedRows,
    trulyUnallocatedPlanned: Math.max(0, moneyDifference(categoryBudget, fixedPlanned)),
    trulyUnallocatedActual: Math.max(0, moneyDifference(unallocatedActual, fixedActual)),
  };
};
