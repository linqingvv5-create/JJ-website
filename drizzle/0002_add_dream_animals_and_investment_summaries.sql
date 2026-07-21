CREATE TABLE IF NOT EXISTS finance_dream_animals (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_member_id TEXT,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS finance_investment_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  investment_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  total_asset_cents INTEGER NOT NULL DEFAULT 0,
  profit_loss_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);
