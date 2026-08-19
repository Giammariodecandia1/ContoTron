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
const navigationVisibilityUrl = await transpileModule('src/lib/navigationVisibilityPreference.ts');
const memberSummaryUrl = await transpileModule('src/lib/memberTransactionSummary.ts');
const personalSpendingUrl = await transpileModule('src/lib/personalSpending.ts');
const aiConfigurationUrl = await transpileModule('src/lib/aiConfiguration.ts');

const {
  countReceiptItemLikeLines,
  extractReceiptItems,
} = await import(receiptUrl);
const { parseReceiptDiscount } = await import(discountUrl);
const { calculateEqualSplit, transactionBelongsToSplit } = await import(splitUrl);
const { recurringRuleAppliesToMonth } = await import(recurringUrl);
const { getViewMode, saveViewMode } = await import(viewModeUrl);
const { getHiddenNavigationPaths, saveHiddenNavigationPaths } = await import(navigationVisibilityUrl);
const {
  summarizeHouseholdSpending,
  summarizeTransactionsByMember,
  unattributedMemberId,
} = await import(memberSummaryUrl);
const { calculatePersonalSpending } = await import(personalSpendingUrl);
const {
  createDefaultAiDraft,
  resolveAiChatEndpoint,
} = await import(aiConfigurationUrl);

assert.deepEqual(createDefaultAiDraft('chiave-test'), {
  apiKey: 'chiave-test',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: 'gemini-3.5-flash-lite',
});
assert.equal(
  resolveAiChatEndpoint('https://servizio.example/v1'),
  'https://servizio.example/v1/chat/completions',
);

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
assert.deepEqual(getHiddenNavigationPaths('utente-a'), []);
saveHiddenNavigationPaths('utente-a', ['/report', '/documenti', '/report']);
assert.deepEqual(getHiddenNavigationPaths('utente-a'), ['/report', '/documenti']);
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

assert.deepEqual(calculatePersonalSpending([
  { type: 'expense', amount: 120, is_shared: true, inserted_by: 'anna' },
  { type: 'expense', amount: 30, is_shared: false, inserted_by: 'anna' },
  { type: 'expense', amount: 12, is_shared: false, inserted_by: 'bruno' },
], 'anna', 3), {
  participantCount: 3,
  sharedExpenses: 120,
  sharedQuota: 40,
  personalExpenses: 30,
  personalTotal: 70,
});

const reportsPageSource = await readFile(new URL('../src/pages/ReportsPage.tsx', import.meta.url), 'utf8');
assert.equal(reportsPageSource.includes('<Card title="Frequenza delle spese">'), false);
assert.equal(reportsPageSource.includes('<Card title="Persone e conti">'), false);
assert.equal(reportsPageSource.includes('<Card title="Documenti archiviati">'), false);

const annualAnalysisSource = await readFile(new URL('../src/pages/AnnualAnalysisPage.tsx', import.meta.url), 'utf8');
assert.equal(annualAnalysisSource.includes('<Card title="Indicazioni di riequilibrio">'), false);
assert.equal(annualAnalysisSource.includes('Sottocategorie</th>'), true);
assert.equal(annualAnalysisSource.includes('row.count += 1;'), true);
assert.equal(annualAnalysisSource.includes('row.amount += amount;\n    };'), true);

const dashboardSource = await readFile(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
const annualExpensesPosition = dashboardSource.indexOf('Spese annuali per categoria');
const categoryBudgetPosition = dashboardSource.indexOf('Budget per categoria');
assert.notEqual(annualExpensesPosition, -1);
assert.notEqual(categoryBudgetPosition, -1);
assert.equal(annualExpensesPosition < categoryBudgetPosition, true);
assert.equal(dashboardSource.includes(".eq('status', 'confirmed')"), true);
assert.equal(dashboardSource.includes('actualDelta: total.actualIncome - total.actualExpense'), true);
assert.equal(dashboardSource.includes('const actualDelta = row.actualIncome - row.actualExpense'), true);
assert.equal(dashboardSource.includes('<th>Entrate effettive</th>'), true);

const transactionHookSource = await readFile(new URL('../src/hooks/useTransactions.ts', import.meta.url), 'utf8');
assert.equal(transactionHookSource.includes("toISOString().split('T')[0]"), false);
assert.equal(transactionHookSource.includes("supabase.rpc('create_transaction_with_items'"), true);

const localDatePages = [
  'src/pages/NewTransactionPage.tsx',
  'src/pages/DocumentsPage.tsx',
  'src/pages/ScanReceiptPage.tsx',
  'src/pages/RecurringRulesPage.tsx',
];
for (const page of localDatePages) {
  const source = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
  assert.equal(source.includes("toISOString().split('T')[0]"), false);
}

const newTransactionSource = await readFile(new URL('../src/pages/NewTransactionPage.tsx', import.meta.url), 'utf8');
const scanReceiptSource = await readFile(new URL('../src/pages/ScanReceiptPage.tsx', import.meta.url), 'utf8');
assert.equal(newTransactionSource.includes('addTransactionWithItems(createPayload, itemRows)'), true);
assert.equal(scanReceiptSource.includes('addTransactionWithItems(transactionPayload, itemRows)'), true);
assert.equal(newTransactionSource.includes("Seleziona la frequenza dell'operazione."), false);
assert.equal(scanReceiptSource.includes("Seleziona la periodicita dell'acquisto."), false);

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const simpleDashboardSource = await readFile(new URL('../src/pages/SimpleDashboardPage.tsx', import.meta.url), 'utf8');
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
assert.equal(appSource.includes('<RouterRoute path="/scan" element={<ScanReceiptPage />} />'), true);
assert.equal(simpleDashboardSource.includes("navigate('/assistente')"), true);
assert.equal(simpleDashboardSource.includes("navigate('/scan')"), true);
assert.equal(simpleDashboardSource.includes('La mia spesa del mese'), true);
assert.equal(sidebarSource.indexOf("path: '/report'") < sidebarSource.indexOf("path: '/mensile'"), true);
assert.equal(sidebarSource.includes(".filter(item => !isHidden(item.path))"), true);

const settingsSource = await readFile(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
assert.equal(settingsSource.includes('Voci da mostrare nel menu'), true);
assert.equal(settingsSource.includes('Mostra tutte'), true);

const documentArchiveSource = await readFile(new URL('../src/lib/documentArchive.ts', import.meta.url), 'utf8');
assert.equal(documentArchiveSource.includes("const requiresGoogleDrive = desiredProvider === 'google_drive';"), true);
assert.equal(documentArchiveSource.includes('Ricollega Google Drive dalle Impostazioni'), true);
assert.equal(documentArchiveSource.includes("status: canUseGoogleDrive ? 'archived_drive_fallback' : 'archived'"), false);
assert.equal(documentArchiveSource.includes('Google Drive non disponibile, uso archivio interno'), false);

const googleDriveSource = await readFile(new URL('../src/lib/googleDriveStorage.ts', import.meta.url), 'utf8');
const googleDriveTokenSource = await readFile(new URL('../src/lib/googleDriveTokenStorage.ts', import.meta.url), 'utf8');
const authContextSource = await readFile(new URL('../src/contexts/AuthContext.tsx', import.meta.url), 'utf8');
const personalDriveHookSource = await readFile(new URL('../src/hooks/usePersonalDriveConnection.ts', import.meta.url), 'utf8');
const transactionsPageSource = await readFile(new URL('../src/pages/TransactionsPage.tsx', import.meta.url), 'utf8');
assert.equal(googleDriveSource.includes('verifyGoogleDriveFolder'), true);
assert.equal(googleDriveSource.includes('verifyGoogleDriveUploadCapability'), true);
assert.equal(googleDriveSource.includes("method: 'DELETE'"), true);
assert.equal(googleDriveTokenSource.includes('TOKEN_LIFETIME_MS = 50 * 60 * 1000'), true);
assert.equal(authContextSource.includes('exchangeData.session.provider_token'), true);
assert.equal(settingsSource.includes('driveCallbackAttemptedRef.current = true'), true);
assert.equal(personalDriveHookSource.includes('L autorizzazione Google Drive e scaduta'), true);
assert.equal(transactionsPageSource.includes('/scan?transactionId='), true);
assert.equal(scanReceiptSource.includes('scan_receipt_attached_to_existing_transaction'), true);
assert.equal(scanReceiptSource.includes('Scontrino collegato alla transazione esistente.'), true);
assert.equal(scanReceiptSource.includes("if (attachTarget && documentStorageProvider === 'google_drive'"), true);
assert.equal(scanReceiptSource.includes('Transazione salvata. Non sono riuscito ad archiviare le foto'), true);

const atomicMigrationSource = await readFile(new URL('../supabase/migrations/025_atomic_transaction_items.sql', import.meta.url), 'utf8');
assert.equal(atomicMigrationSource.includes('create or replace function public.create_transaction_with_items'), true);
assert.equal(atomicMigrationSource.includes('security invoker'), true);
assert.equal(atomicMigrationSource.includes('return to_jsonb(saved_transaction);'), true);

const monthlyBudgetSource = await readFile(new URL('../src/pages/MonthlyBudgetPage.tsx', import.meta.url), 'utf8');
assert.equal(monthlyBudgetSource.includes('Spesa fissa: {rule.description}'), true);

const splitPageSource = await readFile(new URL('../src/pages/SplitPage.tsx', import.meta.url), 'utf8');
assert.equal(splitPageSource.includes('useState(currentMonthStart)'), true);
assert.equal(splitPageSource.includes('useState(currentMonthEnd)'), true);

console.log('Verifica beta: logiche finanziarie e fix visuali agosto 2026 OK');
