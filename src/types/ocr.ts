export interface OcrLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  confidence: number;
}

export interface OcrExtractedData {
  merchant?: string;
  date?: string;
  totalAmount?: number;
  items?: OcrLineItem[];
  confidence: number;
  rawText: string;
}

export interface ReceiptParseResult extends OcrExtractedData {
  suggestedCategoryId?: string;
  suggestedSubcategoryId?: string;
}

export interface PdfParseResult extends OcrExtractedData {
  referencePeriodStart?: string;
  referencePeriodEnd?: string;
  dueDate?: string;
  documentType: 'bill' | 'invoice' | 'contract' | 'other';
}
