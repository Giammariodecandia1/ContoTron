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

const {
  countReceiptItemLikeLines,
  extractReceiptItems,
} = await import(receiptUrl);
const { parseReceiptDiscount } = await import(discountUrl);
const { calculateEqualSplit } = await import(splitUrl);
const { recurringRuleAppliesToMonth } = await import(recurringUrl);
const { getViewMode, saveViewMode } = await import(viewModeUrl);

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

console.log('Verifica beta: sconti OCR, Split, spese ripetitive e modalita semplice OK');
