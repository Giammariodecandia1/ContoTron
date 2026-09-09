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
const paymentTimingStubUrl = `data:text/javascript;base64,${Buffer.from("export const getCashImpactDate = date => date;").toString('base64')}`;
const recurringUrl = await transpileModule('src/lib/recurringTransactions.ts', [
  ["'./supabaseClient'", `'${supabaseStubUrl}'`],
  ["'./paymentTiming'", `'${paymentTimingStubUrl}'`],
]);
const moneyStubUrl = `data:text/javascript;base64,${Buffer.from('export const roundMoney = value => Math.round(value * 100) / 100;').toString('base64')}`;
const recurringBudgetPlanUrl = await transpileModule('src/lib/recurringBudgetPlans.ts', [
  ["'./supabaseClient'", `'${supabaseStubUrl}'`],
  ["'./money'", `'${moneyStubUrl}'`],
]);
const viewModeUrl = await transpileModule('src/lib/viewModePreference.ts');
const navigationVisibilityUrl = await transpileModule('src/lib/navigationVisibilityPreference.ts');
const memberSummaryUrl = await transpileModule('src/lib/memberTransactionSummary.ts');
const personalSpendingUrl = await transpileModule('src/lib/personalSpending.ts');
const monthlyBudgetBreakdownUrl = await transpileModule('src/lib/monthlyBudgetBreakdown.ts');
const aiConfigurationUrl = await transpileModule('src/lib/aiConfiguration.ts');

const {
  countReceiptItemLikeLines,
  extractReceiptItems,
} = await import(receiptUrl);
const { parseReceiptDiscount } = await import(discountUrl);
const { calculateEqualSplit, transactionBelongsToSplit } = await import(splitUrl);
const { recurringRuleAppliesToMonth, recurringRuleDueDateForMonth } = await import(recurringUrl);
const { calculateMonthlyBudgetAllocations } = await import(recurringBudgetPlanUrl);
const { getViewMode, saveViewMode } = await import(viewModeUrl);
const { getHiddenNavigationPaths, saveHiddenNavigationPaths } = await import(navigationVisibilityUrl);
const {
  summarizeHouseholdSpending,
  summarizeTransactionsByMember,
  unattributedMemberId,
} = await import(memberSummaryUrl);
const { calculatePersonalSpending } = await import(personalSpendingUrl);
const { calculateUnallocatedBudgetBreakdown } = await import(monthlyBudgetBreakdownUrl);
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

const subscriptionRule = {
  start_date: '2026-09-15',
  end_date: null,
  frequency: 'bimonthly',
};
assert.equal(recurringRuleDueDateForMonth(subscriptionRule, 2026, 9), '2026-09-15');
assert.equal(recurringRuleDueDateForMonth(subscriptionRule, 2026, 10), null);
assert.equal(recurringRuleDueDateForMonth(subscriptionRule, 2026, 11), '2026-11-15');
assert.equal(recurringRuleDueDateForMonth({ ...subscriptionRule, frequency: 'yearly' }, 2027, 9), '2027-09-15');

const weeklyFoodPlan = [
  2.5319607843137262, 1.1460784313725492, 1.7468627450980392, 0.84392156862745094,
  4.0501960784313722, 3.7801960784313722, 12.846862745098038, 1.6145098039215686,
  5.871764705882355, 9.4358823529411762, 16.484509803921569, 2.2927450980392154,
  3.9347058823529415, 2.6964705882352944, 0.47549019607843146, 1.9486274509803923,
  0.76549019607843138, 5.2794117647058822, 5.2598039215686274, 2.8866666666666672,
  4.1596078431372554, 18.7856862745098, 4.4803921568627443, 0.53196078431372551,
  0.92352941176470582, 0.41235294117647059, 1.509215686274509, 14.179019607843134,
  5.9550980392156863,
].map((weeklyAmount, index) => ({ subcategoryId: `food-${index}`, weeklyAmount }));
const normalizedFoodPlan = calculateMonthlyBudgetAllocations(weeklyFoodPlan, 4.75, 650);
assert.equal(Math.round(normalizedFoodPlan.reduce((sum, item) => sum + item.monthlyAmount, 0) * 100), 65000);
assert.equal(normalizedFoodPlan.every(item => item.monthlyAmount >= 0), true);

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

assert.deepEqual(calculateUnallocatedBudgetBreakdown({
  categoryBudget: 26.99,
  unallocatedActual: 16.99,
  fixedRules: [{ id: 'sim', description: 'SIM CELLULARE', amount: 6.99 }],
  actualByRecurringRule: { sim: 6.99 },
}), {
  fixedRows: [{
    id: 'sim',
    description: 'SIM CELLULARE',
    planned: 6.99,
    actual: 6.99,
    difference: 0,
  }],
  trulyUnallocatedPlanned: 20,
  trulyUnallocatedActual: 10,
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
assert.equal(newTransactionSource.includes('Transazione effettuata da'), true);
assert.equal(newTransactionSource.includes('inserted_by: insertedBy || user?.id || null'), true);
assert.equal(scanReceiptSource.includes('Transazione effettuata da'), true);
assert.equal(scanReceiptSource.includes('attachReceiptAnalysis({'), true);
assert.equal(scanReceiptSource.includes('importo e data originali restano invariati'), true);

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const simpleDashboardSource = await readFile(new URL('../src/pages/SimpleDashboardPage.tsx', import.meta.url), 'utf8');
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
assert.equal(appSource.includes('<RouterRoute path="/scan" element={<ScanReceiptPage />} />'), true);
assert.equal(appSource.includes('<RouterRoute path="/abbonamenti" element={<RecurringRulesPage />} />'), true);
assert.equal(simpleDashboardSource.includes("navigate('/assistente')"), true);
assert.equal(simpleDashboardSource.includes("navigate('/scan')"), true);
assert.equal(simpleDashboardSource.includes('La mia spesa del mese'), true);
assert.equal(sidebarSource.indexOf("path: '/report'") < sidebarSource.indexOf("path: '/mensile'"), true);
assert.equal(sidebarSource.includes(".filter(item => !isHidden(item.path))"), true);
assert.equal(sidebarSource.includes("path: '/abbonamenti', label: 'Abbonamenti'"), true);

const settingsSource = await readFile(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
assert.equal(settingsSource.includes('Voci da mostrare nel menu'), true);
assert.equal(settingsSource.includes('Mostra tutte'), true);
assert.equal(settingsSource.includes('Senza decimali'), true);
assert.equal(settingsSource.includes('Abbonamenti e spese ricorrenti'), true);

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
assert.equal(googleDriveSource.includes('?alt=media'), true);
assert.equal(googleDriveSource.includes('accessToken: serverAccessToken || dedicatedDriveToken || providerToken'), true);
assert.equal(googleDriveSource.includes('getGoogleDriveServerAccessToken(true)'), true);
assert.equal(googleDriveSource.includes('reader.readAsDataURL(blob)'), true);
assert.equal(googleDriveSource.includes('return URL.createObjectURL(blob)'), false);
assert.equal(googleDriveSource.includes('markGoogleDriveConnectionRequested()'), true);
assert.equal(googleDriveSource.includes('saveGoogleDriveAccessToken(userId, providerToken)'), false);
assert.equal(authContextSource.includes('hasGoogleDriveConnectionRequest()'), true);
assert.equal(authContextSource.includes('data.session.provider_token'), true);
assert.equal(authContextSource.includes("'connectDrive'"), true);
assert.equal(documentArchiveSource.includes('getGoogleDriveFileObjectUrl'), true);
assert.equal(documentArchiveSource.includes('getDocumentPreviewUrl'), true);
assert.equal(googleDriveTokenSource.includes('TOKEN_LIFETIME_MS = 50 * 60 * 1000'), true);
assert.equal(authContextSource.includes('exchangeData.session.provider_token'), true);
assert.equal(authContextSource.includes("hashParams.get('provider_token')"), true);
assert.equal(authContextSource.includes('sessionData.session.user.id'), true);
assert.equal(authContextSource.includes('availableProviderRefreshToken'), true);
assert.equal(settingsSource.includes('driveCallbackAttemptedRef.current = true'), true);
assert.equal(personalDriveHookSource.includes('L autorizzazione Google Drive e scaduta'), true);
assert.equal(transactionsPageSource.includes('/scan?transactionId='), true);
assert.equal(scanReceiptSource.includes('scan_receipt_attached_to_existing_transaction'), true);
assert.equal(scanReceiptSource.includes('Scontrino collegato alla transazione esistente.'), true);
assert.equal(scanReceiptSource.indexOf('styles.addItemAction') > scanReceiptSource.indexOf('receiptItems.map'), true);
assert.equal(scanReceiptSource.includes("if (attachTarget && documentStorageProvider === 'google_drive'"), true);
assert.equal(scanReceiptSource.includes('Transazione salvata. Non sono riuscito ad archiviare le foto'), true);

const actorReceiptMigrationSource = await readFile(new URL('../supabase/migrations/028_transaction_actor_and_receipt_analysis.sql', import.meta.url), 'utf8');
assert.equal(actorReceiptMigrationSource.includes('create trigger transactions_enforce_actor'), true);
assert.equal(actorReceiptMigrationSource.includes('Only the household owner can add a transaction for another member'), true);
assert.equal(actorReceiptMigrationSource.includes('create or replace function public.attach_receipt_analysis'), true);
assert.equal(actorReceiptMigrationSource.includes("source = 'receipt_ocr'::public.transaction_source"), true);
assert.equal(actorReceiptMigrationSource.includes('amount ='), false);
assert.equal(actorReceiptMigrationSource.includes('transaction_date ='), false);

const atomicMigrationSource = await readFile(new URL('../supabase/migrations/025_atomic_transaction_items.sql', import.meta.url), 'utf8');
assert.equal(atomicMigrationSource.includes('create or replace function public.create_transaction_with_items'), true);
assert.equal(atomicMigrationSource.includes('security invoker'), true);
assert.equal(atomicMigrationSource.includes('return to_jsonb(saved_transaction);'), true);

const monthlyBudgetSource = await readFile(new URL('../src/pages/MonthlyBudgetPage.tsx', import.meta.url), 'utf8');
assert.equal(monthlyBudgetSource.includes('<RecurringBudgetPlanPanel'), true);
assert.equal(monthlyBudgetSource.includes('dirtyCategoryBudgetIdsRef'), true);
assert.equal(monthlyBudgetSource.includes('budgetInputValue'), true);
assert.equal(monthlyBudgetSource.includes('unallocatedFixedRows.map'), true);
assert.equal(monthlyBudgetSource.includes('Spesa fissa: {rule.description}'), false);
const recurringSource = await readFile(new URL('../src/lib/recurringTransactions.ts', import.meta.url), 'utf8');
const recurringRulesPageSource = await readFile(new URL('../src/pages/RecurringRulesPage.tsx', import.meta.url), 'utf8');
assert.equal(
  recurringSource.indexOf('await syncFixedExpensesIntoBudget') < recurringSource.indexOf('if (requestedMonth > currentMonth)'),
  true,
);
assert.equal(recurringSource.includes('if (!dueDate || dueDate > today) continue;'), true);
assert.equal(recurringRulesPageSource.includes('<label>Cadenza</label>'), true);
assert.equal(recurringRulesPageSource.includes('Abbonamento personale'), true);

const subscriptionMigrationSource = await readFile(new URL('../supabase/migrations/029_recurring_subscription_fields.sql', import.meta.url), 'utf8');
assert.equal(subscriptionMigrationSource.includes('add column if not exists payment_method'), true);
assert.equal(subscriptionMigrationSource.includes('add column if not exists is_shared'), true);
assert.equal(subscriptionMigrationSource.includes('transactions_one_recurring_due_date'), true);

const splitPageSource = await readFile(new URL('../src/pages/SplitPage.tsx', import.meta.url), 'utf8');
assert.equal(splitPageSource.includes('useState(currentMonthStart)'), true);
assert.equal(splitPageSource.includes('useState(currentMonthEnd)'), true);

const voiceTransactionSource = await readFile(new URL('../src/lib/aiVoiceTransaction.ts', import.meta.url), 'utf8');
const googleDriveServerTokenSource = await readFile(new URL('../src/lib/googleDriveServerToken.ts', import.meta.url), 'utf8');
const googleDriveTokenFunctionSource = await readFile(new URL('../supabase/functions/google-drive-token/index.ts', import.meta.url), 'utf8');
assert.equal(voiceTransactionSource.includes('analyzeVoiceTransactionWithAi'), true);
assert.equal(voiceTransactionSource.includes('Usa esclusivamente gli ID di categorie, sottocategorie e conti'), true);
assert.equal(newTransactionSource.includes('webkitSpeechRecognition'), true);
assert.equal(newTransactionSource.includes('Compila modulo'), true);
assert.equal(newTransactionSource.includes('nulla viene salvato senza la tua conferma'), true);
assert.equal(googleDriveServerTokenSource.includes("action: 'get_access_token'"), true);
assert.equal(googleDriveServerTokenSource.includes('cachedAccessToken'), true);
assert.equal(googleDriveTokenFunctionSource.includes('store_refresh_token'), true);
assert.equal(googleDriveTokenFunctionSource.includes('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'), true);
assert.equal(googleDriveTokenFunctionSource.includes('crypto.subtle.encrypt'), true);
assert.equal(googleDriveTokenFunctionSource.includes('verifyDriveFileScope'), true);

console.log('Verifica beta: logiche finanziarie e fix visuali agosto 2026 OK');
