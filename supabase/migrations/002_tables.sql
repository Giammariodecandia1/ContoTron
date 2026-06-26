-- =========================================================
-- 02. PROFILES
-- =========================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =========================================================
-- 03. HOUSEHOLDS
-- =========================================================

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'EUR',
  budget_month_start_day integer not null default 1,
  document_storage_provider text not null default 'supabase' check (document_storage_provider in ('supabase', 'google_drive')),
  document_storage_status text not null default 'ready' check (document_storage_status in ('ready', 'pending_connection', 'connection_error')),
  document_storage_config jsonb not null default '{}'::jsonb,
  document_storage_connected_by uuid references profiles(id),
  document_storage_connected_at timestamptz,
  google_drive_folder_id text,
  google_drive_folder_name text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz default now(),
  unique (household_id, user_id)
);

-- =========================================================
-- 04. ACCOUNTS
-- =========================================================

create table accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  type account_type not null default 'current_account',
  opening_balance numeric(12,2) not null default 0,
  current_balance_manual numeric(12,2),
  include_in_total boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =========================================================
-- 05. CATEGORIES
-- =========================================================

create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  type transaction_type not null default 'expense',
  sort_order integer default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  unique (household_id, name, type)
);

create table subcategories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  sort_order integer default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  unique (category_id, name)
);

-- =========================================================
-- 06. DOCUMENTS & OCR
-- =========================================================

create table documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  uploaded_by uuid references profiles(id),
  type document_type not null default 'other',
  original_filename text not null,
  storage_path text not null,
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'google_drive')),
  external_file_id text,
  external_url text,
  mime_type text,
  file_size_bytes bigint,
  document_date date,
  reference_period_start date,
  reference_period_end date,
  vendor_name text,
  total_amount numeric(12,2),
  status text default 'uploaded',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  provider text not null default 'tesseract',
  status ocr_status not null default 'queued',
  extracted_text text,
  extracted_json jsonb,
  confidence numeric(5,2),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- =========================================================
-- 07. TRANSACTIONS
-- =========================================================

create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid references accounts(id),
  destination_account_id uuid references accounts(id),
  document_id uuid references documents(id) on delete set null,

  type transaction_type not null,
  status transaction_status not null default 'confirmed',
  source transaction_source not null default 'manual',

  transaction_date date not null,
  description text not null,
  merchant text,
  amount numeric(12,2) not null,

  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),

  is_shared boolean not null default true,
  inserted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint amount_positive check (amount >= 0),
  constraint transfer_destination_required check (
    type <> 'transfer' or destination_account_id is not null
  )
);

create table transaction_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  description text not null,
  quantity numeric(10,3),
  unit_price numeric(12,2),
  amount numeric(12,2) not null,
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  ocr_confidence numeric(5,2),
  is_confirmed boolean not null default false,
  created_at timestamptz default now()
);

-- =========================================================
-- 08. BUDGETS
-- =========================================================

create table budget_targets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  planned_amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (household_id, year, month, category_id, subcategory_id)
);

-- =========================================================
-- 09. RECURRING RULES / RATE / PRESTITI
-- =========================================================

create table recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid references accounts(id),
  type transaction_type not null default 'expense',
  description text not null,
  merchant text,
  amount numeric(12,2) not null,
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  frequency text not null, -- monthly, weekly, yearly, custom
  start_date date not null,
  end_date date,
  next_due_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table loans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid references accounts(id),
  description text not null,
  lender text,
  installment_amount numeric(12,2) not null,
  start_date date not null,
  end_date date,
  total_installments integer,
  paid_installments integer default 0,
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =========================================================
-- 10. CLASSIFICATION RULES
-- =========================================================

create table classification_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  match_text text not null,
  merchant text,
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  priority integer not null default 100,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- =========================================================
-- 11. AUDIT LOG
-- =========================================================

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid references profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);
