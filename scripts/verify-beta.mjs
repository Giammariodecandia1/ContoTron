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

const {
  countReceiptItemLikeLines,
  extractReceiptItems,
} = await import(receiptUrl);
const { parseReceiptDiscount } = await import(discountUrl);
const { calculateEqualSplit } = await import(splitUrl);

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

console.log('Verifica beta: sconti OCR e calcolo Split OK');
