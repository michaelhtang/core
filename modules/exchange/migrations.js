// exchange migrations: the module's schema, in order (001_exchange to 008_retirement); never edit an applied one, add a new entry
export const migrations = [{ id: '001_exchange', sql: `
CREATE TABLE exchange_prices (        -- the seeded series: one row per world, ticker and month, price in micro-cents (1e-4 cent); halted = the circuit breaker paused it that month
  world_id INTEGER NOT NULL, ticker TEXT NOT NULL, month INTEGER NOT NULL, price_micro INTEGER NOT NULL, halted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, ticker, month)
) WITHOUT ROWID;
CREATE TABLE exchange_holdings (      -- units in micro-units (1e-6); cost_cents is what the student paid, spread included (the cost basis)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, account TEXT NOT NULL, ticker TEXT NOT NULL,
  units_micro INTEGER NOT NULL DEFAULT 0 CHECK (units_micro >= 0), cost_cents INTEGER NOT NULL DEFAULT 0, drip INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, account, ticker)
);
CREATE INDEX exchange_holdings_world ON exchange_holdings(world_id, ended, ticker);
CREATE TABLE exchange_orders (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, account TEXT NOT NULL, ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), type TEXT NOT NULL CHECK (type IN ('market','limit')), units_micro INTEGER NOT NULL, limit_micro INTEGER,
  hold_cents INTEGER NOT NULL DEFAULT 0,     -- cash held for an open buy limit (also on the student's xhold account)
  status TEXT NOT NULL CHECK (status IN ('open','filled','cancelled','expired','ended')), placed_month INTEGER NOT NULL, expires_month INTEGER, filled_month INTEGER, created INTEGER NOT NULL
);
CREATE INDEX exchange_orders_open ON exchange_orders(world_id, status);
CREATE INDEX exchange_orders_player ON exchange_orders(player_id, world_id, placed_month);
CREATE TABLE exchange_trades (
  id INTEGER PRIMARY KEY, order_id INTEGER, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, account TEXT NOT NULL, ticker TEXT NOT NULL,
  side TEXT NOT NULL, units_micro INTEGER NOT NULL, price_micro INTEGER NOT NULL, cents INTEGER NOT NULL, basis_cents INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL, txn_id INTEGER, via TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
);
CREATE INDEX exchange_trades_month ON exchange_trades(world_id, month);
CREATE INDEX exchange_trades_player ON exchange_trades(player_id, world_id);
CREATE TABLE exchange_tfsa (          -- contributions and withdrawals by world year; room is worked out from these (orders.js tfsaRoom)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, year INTEGER NOT NULL, contributed_cents INTEGER NOT NULL DEFAULT 0, withdrawn_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, year)
);
CREATE TABLE exchange_dividends (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, world_id INTEGER NOT NULL, month INTEGER NOT NULL, ticker TEXT NOT NULL, account TEXT NOT NULL, units_micro INTEGER NOT NULL, cents INTEGER NOT NULL, drip INTEGER NOT NULL);
CREATE INDEX exchange_dividends_player ON exchange_dividends(player_id, world_id);
CREATE TABLE exchange_news (id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, month INTEGER NOT NULL, kind TEXT NOT NULL, ticker TEXT, text TEXT NOT NULL);
CREATE INDEX exchange_news_world ON exchange_news(world_id, id);
CREATE TABLE exchange_events (        -- teacher market events: queued now, applied at the next tick
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, kind TEXT NOT NULL, ticker TEXT, created_month INTEGER NOT NULL, applied_month INTEGER, by_player INTEGER, created INTEGER NOT NULL
);
CREATE TABLE exchange_rates (world_id INTEGER PRIMARY KEY, policy_bp INTEGER NOT NULL, applied_bp INTEGER);   -- the policy rate rates announced, and the one the bond fund last priced in
CREATE TABLE exchange_settings (world_id INTEGER PRIMARY KEY, frozen INTEGER NOT NULL DEFAULT 0);
CREATE TABLE exchange_valued (player_id INTEGER NOT NULL, world_id INTEGER NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id))   -- the last holdings value announced` },
    { id: '002_secrets', sql: `CREATE TABLE exchange_secrets (world_id INTEGER PRIMARY KEY, secret TEXT NOT NULL)   -- the per-world price seed secret: never sent to a browser` },
    { id: '003_rrsp', sql: `
CREATE TABLE exchange_income (        -- earned income by world year, summed from module.jobs.paid (gross, cents): the only way this module learns what a student earns
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, year INTEGER NOT NULL, gross_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, year)
);
CREATE TABLE exchange_rrsp (          -- RRSP contributions, withdrawals (gross) and the tax withheld on them, by world year
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, year INTEGER NOT NULL,
  contributed_cents INTEGER NOT NULL DEFAULT 0, withdrawn_cents INTEGER NOT NULL DEFAULT 0, withheld_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, year)
);
CREATE TABLE exchange_settlements (   -- the year-end tax slip: G earned, C contributed, W withdrawn, H withheld; carry_cents = owing brought in from the year before
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
  g_cents INTEGER NOT NULL, c_cents INTEGER NOT NULL, w_cents INTEGER NOT NULL, h_cents INTEGER NOT NULL, tax_before_cents INTEGER NOT NULL, tax_after_cents INTEGER NOT NULL,
  carry_cents INTEGER NOT NULL, refund_cents INTEGER NOT NULL, owing_cents INTEGER NOT NULL, paid_cents INTEGER NOT NULL, unpaid_cents INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id, year)
)` },
    { id: '004_rate_pending', sql: `CREATE TABLE exchange_rate_pending (world_id INTEGER PRIMARY KEY, pending_bp INTEGER NOT NULL, effective_month INTEGER NOT NULL)   -- from module.rates.pending: a queued policy change` },
    { id: '005_listings', sql: `
CREATE TABLE exchange_listings (      -- stocks listed through the listSecurity service (Phase 4: a student business's IPO), per world; delisted_month set = no longer traded
  world_id INTEGER NOT NULL REFERENCES worlds(id), ticker TEXT NOT NULL, name TEXT NOT NULL, sector TEXT NOT NULL,
  sigma_bp INTEGER NOT NULL, tilt_bp INTEGER NOT NULL, start_cents INTEGER NOT NULL, shares_outstanding INTEGER NOT NULL,
  owner_business_id INTEGER,          -- the listing module's business id (accounts.owner_type 'business'); not checked here
  listed_by TEXT NOT NULL,            -- the module that called listSecurity: only it may delist
  listed_month INTEGER NOT NULL, delisted_month INTEGER, created INTEGER NOT NULL,
  PRIMARY KEY (world_id, ticker)
)` },
    { id: '006_headline', sql: `
-- stageEvent's own headline for the news (NULL: the template)
ALTER TABLE exchange_events ADD COLUMN headline TEXT` },
    { id: '007_limits', sql: `
-- the TFSA and RRSP dollar limits of each world year, frozen at its first tick: written only when the life module and rates are loaded (indexed limits)
CREATE TABLE exchange_limits (world_id INTEGER NOT NULL REFERENCES worlds(id), year INTEGER NOT NULL, tfsa_cents INTEGER NOT NULL, rrsp_cents INTEGER NOT NULL, index_bp INTEGER NOT NULL,
  PRIMARY KEY (world_id, year))` }, { id: '008_retirement', sql: `
-- 5c: retirement income (CPP + OAS, from the retirement module's recordRetirementIncome) and the tax withheld on it, by world year: the year-end settlement taxes it
ALTER TABLE exchange_rrsp ADD COLUMN pension_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exchange_rrsp ADD COLUMN pension_withheld_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exchange_rrsp ADD COLUMN oas_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exchange_settlements ADD COLUMN p_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exchange_settlements ADD COLUMN clawback_cents INTEGER NOT NULL DEFAULT 0` }];
