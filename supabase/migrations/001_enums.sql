-- =========================================================
-- 01. ENUMS
-- =========================================================

create type member_role as enum ('owner', 'editor', 'viewer');

create type account_type as enum (
  'current_account',
  'prepaid_card',
  'savings_book',
  'wallet',
  'cash',
  'credit_card',
  'other'
);

create type transaction_type as enum (
  'income',
  'expense',
  'transfer'
);

create type transaction_status as enum (
  'draft',
  'pending_review',
  'confirmed',
  'rejected',
  'deleted'
);

create type transaction_source as enum (
  'manual',
  'receipt_ocr',
  'pdf_bill',
  'csv_import',
  'excel_import',
  'recurring_rule'
);

create type document_type as enum (
  'receipt',
  'bill',
  'invoice',
  'bank_statement',
  'contract',
  'other'
);

create type ocr_status as enum (
  'queued',
  'processing',
  'completed',
  'failed',
  'skipped'
);
