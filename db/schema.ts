// D1 schema source of truth for the family finance module.
// The existing investment board remains stored in shared_state/board-state.

export const financeSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS finance_member_locks (
    member_id TEXT PRIMARY KEY NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_members (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    is_current_user INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    body TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    owner_member_id TEXT,
    current_balance_cents INTEGER NOT NULL DEFAULT 0,
    include_in_family_assets INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS finance_accounts_owner_idx ON finance_accounts(owner_member_id)`,
  `CREATE TABLE IF NOT EXISTS finance_categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    direction TEXT NOT NULL,
    parent_id TEXT,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS finance_categories_parent_idx ON finance_categories(parent_id)`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    occurred_at TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    category_id TEXT,
    from_account_id TEXT,
    to_account_id TEXT,
    bookkeeper_member_id TEXT,
    payer_member_id TEXT,
    ownership TEXT NOT NULL,
    include_in_family_stats INTEGER NOT NULL DEFAULT 1,
    goal_id TEXT,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_accounts_idx ON finance_transactions(from_account_id, to_account_id)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_goal_idx ON finance_transactions(goal_id)`,
  `CREATE TABLE IF NOT EXISTS finance_dream_animals (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    owner_member_id TEXT,
    body TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_goals (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    target_amount_cents INTEGER NOT NULL DEFAULT 0,
    allocated_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    body TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_goal_entries (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS finance_goal_entries_goal_idx ON finance_goal_entries(goal_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_asset_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    snapshot_date TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_id TEXT,
    net_asset_cents INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS finance_asset_snapshots_date_idx ON finance_asset_snapshots(snapshot_date DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_investment_summaries (
    id TEXT PRIMARY KEY NOT NULL,
    investment_account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    total_asset_cents INTEGER NOT NULL DEFAULT 0,
    profit_loss_cents INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    body TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_meta (
    id TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`
] as const;
