-- =========================================================
-- INDEXES FOR PERFORMANCE
-- =========================================================

-- Transactions
create index idx_transactions_household_date on transactions (household_id, transaction_date);
create index idx_transactions_account on transactions (account_id);
create index idx_transactions_category on transactions (category_id);
create index idx_transactions_document on transactions (document_id);

-- Budgets
create index idx_budget_targets_lookup on budget_targets (household_id, year, month);

-- Accounts
create index idx_accounts_household on accounts (household_id);

-- Documents
create index idx_documents_household on documents (household_id);

-- Recurring Rules
create index idx_recurring_rules_household on recurring_rules (household_id);
