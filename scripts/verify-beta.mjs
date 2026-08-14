import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const transpileModule = async (path, replacements = []) => {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  replacements.forEach(([from, to]) => {
    output = output.replaceAll(from, to);
  });

  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
};

const discountUrl = await transpileModule('src/lib/receiptDiscounts.ts');
const receiptUrl = await transpileModule('src/lib/receiptParsing.ts', [
  ["'./receiptDiscounts'", `'${discountUrl}'`],
]);
const splitUrl = await transpileModule('src/lib/splitCalculator.ts');
const supabaseStubUrl = `data:text/javascript;base64,${Buffer.from('export const supabase = {};').toString('base64')}`;
const recurringUrl = await transpileModule('src/lib/recurringTransactions.ts', [
  ["'./supabaseClient'", `'${supabaseStubUrl}'`],
]);
const viewModeUrl = await transpileModule('src/lib/viewModePreference.ts');
const memberSummaryUrl = await transpileModule('src/lib/memberTransactionSummary.ts');

const {
  countReceiptItemLikeLines,
  extractReceiptItems,
} = await import(receiptUrl);
const { parseReceiptDiscount } = await import(discountUrl);
const { calculateEqualSplit, transactionBelongsToSplit } = await import(splitUrl);
const { recurringRuleAppliesToMonth } = await import(recurringUrl);
const { getViewMode, saveViewMode } = await import(viewModeUrl);
const {
  summarizeHouseholdSpending,
  summarizeTransactionsByMember,
  unattributedMemberId,
} = await import(memberSummaryUrl);

assert.equal(parseReceiptDiscount('SCONTO -1,20'), 1.2);
assert.equal(parseReceiptDiscount('VALORI SCONTI - EUR 0,50'), 0.5);
assert.equal(parseReceiptDiscount('PASTA 5,00'), null);

const discountedItems = extractReceiptItems('PANE 5,00\nSCONTO\n- 1,20', [], []);
assert.equal(discountedItems.length, 1);
assert.equal(discountedItems[0].amount, 3.8);
assert.equal(countReceiptItemLikeLines('PANE 5,00\nSCONTO\n- 1,20'), 1);

const twoPeople = calculateEqualSplit(
  [
    { userId: 'a', displayName: 'Anna' },
    { userId: 'b', displayName: 'Bruno' },
  ],
  [{ userId: 'a', amountCents: 10000 }],
);
assert.equal(twoPeople.totalCents, 10000);
assert.deepEqual(twoPeople.balances.map(row => row.balanceCents), [5000, -5000]);
assert.deepEqual(twoPeople.settlements, [{
  fromUserId: 'b',
  from: 'Bruno',
  toUserId: 'a',
  to: 'Anna',
  amountCents: 5000,
}]);

assert.equal(transactionBelongsToSplit({ type: 'expense', status: 'confirmed', is_shared: true }), true);
assert.equal(transactionBelongsToSplit({ type: 'expense', status: 'confirmed', is_shared: false }), false);
assert.equal(transactionBelongsToSplit({ type: 'income', status: 'confirmed', is_shared: true }), false);
assert.equal(transactionBelongsToSplit({ type: 'expense', status: 'rejected', is_shared: true }), false);

const threePeople = calculateEqualSplit(
  [
    { userId: 'a', displayName: 'Anna' },
    { userId: 'b', displayName: 'Bruno' },
    { userId: 'c', displayName: 'Carla' },
  ],
  [
    { userId: 'a', amountCents: 10001 },
    { userId: 'b', amountCents: 2000 },
  ],
);
assert.equal(threePeople.balances.reduce((sum, row) => sum + row.balanceCents, 0), 0);
assert.equal(
  threePeople.settlements.reduce((sum, row) => sum + row.amountCents, 0),
  threePeople.balances.filter(row => row.balanceCents < 0).reduce((sum, row) => sum - row.balanceCents, 0),
);

const monthlyRule = {
  start_date: '2026-03-15',
  end_date: '2026-08-20',
};
assert.equal(recurringRuleAppliesToMonth(monthlyRule, 2026, 3), true);
assert.equal(recurringRuleAppliesToMonth(monthlyRule, 2026, 8), true);
assert.equal(recurringRuleAppliesToMonth(monthlyRule, 2026, 2), false);
assert.equal(recurringRuleAppliesToMonth(monthlyRule, 2026, 9), false);

const storedPreferences = new Map();
globalThis.window = {
  localStorage: {
    getItem: key => storedPreferences.get(key) ?? null,
    setItem: (key, value) => storedPreferences.set(key, value),
  },
};

assert.equal(getViewMode('utente-a'), 'complete');
saveViewMode('utente-a', 'simple');
assert.equal(getViewMode('utente-a'), 'simple');
assert.equal(getViewMode('utente-b'), 'complete');
saveViewMode('utente-a', 'complete');
assert.equal(getViewMode('utente-a'), 'complete');
delete globalThis.window;

const memberSummaries = summarizeTransactionsByMember(
  [
    { userId: 'anna', displayName: 'Anna', email: null },
    { userId: 'bruno', displayName: 'Bruno', email: null },
  ],
  [
    { inserted_by: 'anna', type: 'expense', amount: 40 },
    { inserted_by: 'anna', type: 'income', amount: 10 },
    { inserted_by: null, type: 'expense', amount: 5 },
  ],
);
assert.deepEqual(
  memberSummaries.map(summary => ({
    userId: summary.userId,
    count: summary.transactionCount,
    expenses: summary.expenses,
    income: summary.income,
  })),
  [
    { userId: 'anna', count: 2, expenses: 40, income: 10 },
    { userId: 'bruno', count: 0, expenses: 0, income: 0 },
    { userId: unattributedMemberId, count: 1, expenses: 5, income: 0 },
  ],
);

const spendingSummary = summarizeHouseholdSpending([
  { inserted_by: 'anna', type: 'expense', amount: 40, is_shared: true },
  { inserted_by: 'anna', type: 'expense', amount: 15, is_shared: false },
  { inserted_by: 'bruno', type: 'expense', amount: 10, is_shared: true },
  { inserted_by: 'anna', type: 'income', amount: 100, is_shared: true },
  { inserted_by: 'anna', type: 'expense', amount: 99, is_shared: true, status: 'rejected' },
], 'anna');
assert.deepEqual(spendingSummary, {
  householdExpenses: 65,
  householdExpenseCount: 3,
  myExpenses: 55,
  myExpenseCount: 2,
  sharedExpenses: 50,
});

const reportsPageSource = await readFile(new URL('../src/pages/ReportsPage.tsx', import.meta.url), 'utf8');
assert.equal(reportsPageSource.includes('<Card title="Frequenza delle spese">'), false);
assert.equal(reportsPageSource.includes('<Card title="Persone e conti">'), false);
assert.equal(reportsPageSource.includes('<Card title="Documenti archiviati">'), false);

const annualAnalysisSource = await readFile(new URL('../src/pages/AnnualAnalysisPage.tsx', import.meta.url), 'utf8');
assert.equal(annualAnalysisSource.includes('<Card title="Indicazioni di riequilibrio">'), false);

const dashboardSource = await readFile(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
const annualExpensesPosition = dashboardSource.indexOf('Spese annuali per categoria');
const categoryBudgetPosition = dashboardSource.indexOf('Budget per categoria');
assert.notEqual(annualExpensesPosition, -1);
assert.notEqual(categoryBudgetPosition, -1);
assert.equal(annualExpensesPosition < categoryBudgetPosition, true);

const monthlyBudgetSource = await readFile(new URL('../src/pages/MonthlyBudgetPage.tsx', import.meta.url), 'utf8');
assert.equal(monthlyBudgetSource.includes('Spesa fissa: {rule.description}'), true);

const splitPageSource = await readFile(new URL('../src/pages/SplitPage.tsx', import.meta.url), 'utf8');
assert.equal(splitPageSource.includes('useState(currentMonthStart)'), true);
assert.equal(splitPageSource.includes('useState(currentMonthEnd)'), true);

console.log('Verifica beta: logiche finanziarie e fix visuali agosto 2026 OK');
