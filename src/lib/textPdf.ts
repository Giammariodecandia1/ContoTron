export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  mono?: boolean;
  indent?: number;
  gapAfter?: number;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 42;
const TOP_Y = 800;
const BOTTOM_Y = 54;

const toPdfSafeText = (value: string) => (
  value
    .replace(/\u20ac/g, 'EUR')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
);

const escapePdfText = (value: string) => (
  toPdfSafeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
);

const wrapText = (value: string, maxChars: number) => {
  const safeValue = toPdfSafeText(value).trimEnd();
  if (!safeValue) return [''];

  const words = safeValue.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  words.forEach(word => {
    if (!current) {
      current = word;
      return;
    }

    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  });

  if (current) lines.push(current);
  return lines;
};

export const createTextPdf = (lines: PdfLine[]) => {
  const pages: string[][] = [[]];
  let pageIndex = 0;
  let y = TOP_Y;

  const addPage = () => {
    pages.push([]);
    pageIndex += 1;
    y = TOP_Y;
  };

  const addText = (line: PdfLine, text: string) => {
    const size = line.size || 10;
    const font = line.mono ? 'F3' : line.bold ? 'F2' : 'F1';
    const x = MARGIN_X + (line.indent || 0);
    pages[pageIndex].push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`);
    y -= Math.max(size + 4, 12);
  };

  lines.forEach(line => {
    const size = line.size || 10;
    const indent = line.indent || 0;
    const approxCharWidth = line.mono ? size * 0.58 : size * 0.5;
    const maxChars = Math.max(24, Math.floor((PAGE_WIDTH - (MARGIN_X * 2) - indent) / approxCharWidth));
    const wrapped = wrapText(line.text, maxChars);

    wrapped.forEach(part => {
      if (y < BOTTOM_Y) addPage();
      addText(line, part);
    });

    if (line.gapAfter) {
      y -= line.gapAfter;
    }
  });

  pages.forEach((page, index) => {
    page.push(`BT /F1 8 Tf ${MARGIN_X.toFixed(2)} 28.00 Td (Contotron - pagina ${index + 1}/${pages.length}) Tj ET`);
  });

  const fontObjectNumber = 3 + pages.length * 2;
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');

  const pageRefs = pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const content = page.join('\n');

    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectNumber} 0 R /F2 ${fontObjectNumber + 1} 0 R /F3 ${fontObjectNumber + 2} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
};
