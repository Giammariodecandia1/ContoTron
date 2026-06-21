export type ExcelCell = string | number | null | undefined;

export interface ExcelSheet {
  name: string;
  rows: ExcelCell[][];
}

const escapeXml = (value: string) => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
);

const normalizeSheetName = (value: string) => {
  const cleaned = value.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Foglio';
  return cleaned.slice(0, 31);
};

const cellToXml = (cell: ExcelCell, isHeader: boolean) => {
  if (cell === null || cell === undefined) {
    return `<Cell${isHeader ? ' ss:StyleID="Header"' : ''}><Data ss:Type="String"></Data></Cell>`;
  }

  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return `<Cell${isHeader ? ' ss:StyleID="Header"' : ' ss:StyleID="Money"'}><Data ss:Type="Number">${cell}</Data></Cell>`;
  }

  return `<Cell${isHeader ? ' ss:StyleID="Header"' : ''}><Data ss:Type="String">${escapeXml(String(cell))}</Data></Cell>`;
};

export const createExcelWorkbook = (sheets: ExcelSheet[]) => {
  const worksheets = sheets.map(sheet => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map(cell => cellToXml(cell, rowIndex === 0)).join('');
      return `<Row>${cells}</Row>`;
    }).join('');

    return `
      <Worksheet ss:Name="${escapeXml(normalizeSheetName(sheet.name))}">
        <Table>${rows}</Table>
      </Worksheet>
    `;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Money">
      <NumberFormat ss:Format="#,##0.00"/>
    </Style>
  </Styles>
  ${worksheets}
</Workbook>`;

  return new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
};
