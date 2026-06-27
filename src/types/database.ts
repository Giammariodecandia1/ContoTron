export type MemberRole = 'owner' | 'editor' | 'viewer';

export type AccountType = 
  | 'current_account'
  | 'prepaid_card'
  | 'savings_book'
  | 'wallet'
  | 'cash'
  | 'credit_card'
  | 'other';

export type TransactionType = 'income' | 'expense' | 'transfer';

export type TransactionStatus = 
  | 'draft'
  | 'pending_review'
  | 'confirmed'
  | 'rejected'
  | 'deleted';

export type TransactionSource = 
  | 'manual'
  | 'receipt_ocr'
  | 'pdf_bill'
  | 'csv_import'
  | 'excel_import'
  | 'recurring_rule';

export type DocumentType = 
  | 'receipt'
  | 'bill'
  | 'invoice'
  | 'bank_statement'
  | 'contract'
  | 'other';

export type OcrStatus = 
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

export type DocumentStorageProvider = 'supabase' | 'google_drive';

export type DocumentStorageStatus =
  | 'ready'
  | 'pending_connection'
  | 'connection_error';

export interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Household {
  id: string;
  name: string;
  currency: string;
  budget_month_start_day: number;
  invite_code?: string | null;
  document_storage_provider?: DocumentStorageProvider | null;
  document_storage_status?: DocumentStorageStatus | null;
  document_storage_config?: Record<string, unknown> | null;
  document_storage_connected_by?: string | null;
  document_storage_connected_at?: string | null;
  google_drive_folder_id?: string | null;
  google_drive_folder_name?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

export interface Account {
  id: string;
  household_id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  current_balance_manual: number | null;
  include_in_total: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  type: TransactionType;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Subcategory {
  id: string;
  household_id: string;
  category_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  household_id: string;
  account_id: string | null;
  destination_account_id: string | null;
  document_id: string | null;
  type: TransactionType;
  status: TransactionStatus;
  source: TransactionSource;
  transaction_date: string;
  description: string;
  merchant: string | null;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  is_shared: boolean;
  inserted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionItem {
  id: string;
  household_id: string;
  transaction_id: string;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  ocr_confidence: number | null;
  is_confirmed: boolean;
  created_at: string;
}

export interface BudgetTarget {
  id: string;
  household_id: string;
  year: number;
  month: number;
  category_id: string | null;
  subcategory_id: string | null;
  planned_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  household_id: string;
  uploaded_by: string | null;
  type: DocumentType;
  original_filename: string;
  storage_path: string;
  storage_provider?: DocumentStorageProvider | null;
  external_file_id?: string | null;
  external_url?: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  document_date: string | null;
  reference_period_start: string | null;
  reference_period_end: string | null;
  vendor_name: string | null;
  total_amount: number | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface OcrJob {
  id: string;
  household_id: string;
  document_id: string;
  provider: string;
  status: OcrStatus;
  extracted_text: string | null;
  extracted_json: any | null;
  confidence: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RecurringRule {
  id: string;
  household_id: string;
  account_id: string | null;
  type: TransactionType;
  description: string;
  merchant: string | null;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  frequency: string;
  start_date: string;
  end_date: string | null;
  next_due_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Loan {
  id: string;
  household_id: string;
  account_id: string | null;
  description: string;
  lender: string | null;
  installment_amount: number;
  start_date: string;
  end_date: string | null;
  total_installments: number | null;
  paid_installments: number;
  category_id: string | null;
  subcategory_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationRule {
  id: string;
  household_id: string;
  match_text: string;
  merchant: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority: number;
  use_count: number;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  household_id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  old_data: any | null;
  new_data: any | null;
  created_at: string;
}
