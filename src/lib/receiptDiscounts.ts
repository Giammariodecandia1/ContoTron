const normalizeDiscountMoneyText = (value: string) => (
  value
    .replace(/\b[Oo](?=\s*[,.]\s*\d{2}\b)/g, '0')
    .replace(/(\d)[Oo](?=\d|[,.])/g, (_, digit: string) => `${digit}0`)
    .replace(/([,.]\s*)[Oo](?=\d)/g, (_, prefix: string) => `${prefix}0`)
    .replace(/\s+([,.])\s+/g, '$1')
);

/** Returns the absolute discount when an OCR line contains a minus before a price. */
export const parseReceiptDiscount = (line: string): number | null => {
  const normalized = normalizeDiscountMoneyText(line);
  const regex = /(?:(?:EUR|EURO|\u20ac)\s*)?[-\u2212\u2013\u2014]\s*(?:(?:EUR|EURO|\u20ac)\s*)?(\d{1,4}(?:[.\s]\d{3})*|\d+)\s*[,.]\s*(\d{2})/gi;
  let match: RegExpExecArray | null;
  let discount: number | null = null;

  while ((match = regex.exec(normalized)) !== null) {
    const integerPart = match[1].replace(/[.\s]/g, '');
    const value = Number(`${integerPart}.${match[2]}`);
    if (Number.isFinite(value) && value > 0 && value < 10000) discount = value;
  }

  return discount;
};

export const applyReceiptDiscountToPrevious = <T extends { amount: number; rawLine: string }>(
  items: T[],
  line: string,
) => {
  const discount = parseReceiptDiscount(line);
  if (discount === null) return false;

  const previous = items[items.length - 1];
  if (previous) {
    previous.amount = Number(Math.max(0, previous.amount - discount).toFixed(2));
    previous.rawLine = `${previous.rawLine}\nSconto applicato: ${line}`;
  }

  // A discount is never emitted as a separate purchased product.
  return true;
};
