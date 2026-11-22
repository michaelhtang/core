// Every default for `rates` (the Bank of DAA), in basis points (1 bp = 0.01%) so all rate math stays in integers.
// Sources (checked 2026-10-22). Each spread is a classroom default and can be overridden in config.options.rates.
//   POLICY_BP 225: Bank of Canada overnight rate target 2.25%, held on Sept 2, 2026. https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/
//   PRIME 4.45% = policy + 220 bp: the big banks' prime rate, which tracks the policy rate at a fixed spread (policy 2.25% -> prime 4.45%).
//   HISA 2.75% = policy + 50 bp: matches savings' old fixed default (Ratehub savings comparison, Sept 2026; see modules/savings/constants.js).
//   5-year fixed mortgage 4.20% = policy + 195 bp: inside the ~4.0-4.4% advertised insured 5-year fixed range in 2026 (Ratehub / Canadian mortgage lenders).
//   Variable mortgage = prime - 50 bp; line of credit = prime + 300 bp (illustrative bank pricing, typical secured/unsecured LOC spreads).
//   Credit card 20.99%: the typical purchase APR on Canadian bank cards, a fixed rate that does not follow the policy rate.
export const SOURCES_CHECKED = '2026-10-22';
export const POLICY_BP = 225;
export const MAX_POLICY_BP = 1000;                  // the teacher's lever: 0% to 10%
export const SPREADS = { prime: 220, hisa: 50, mortgage5y: 195, mortgageVar: -50, loc: 300 };   // mortgageVar and loc are relative to PRIME, the rest to policy
export const CARD_APR_BP = 2099;
// Like the Bank of Canada's 8 fixed announcement dates a year: these world months (1-12) of each world year.
export const ANNOUNCE_MONTHS = [1, 3, 4, 6, 7, 9, 10, 12];

// Inflation: the world's annual price increase (CPI), applied as a price index that steps once per world year (months 13, 25, 37, ...).
//   INFLATION_BP 210 = 2.1%: PLAN.md's base inflation for the game (section 4, "Base inflation is 2.1%"). It sits just above the Bank of Canada's 2% inflation-control
//   target, the midpoint of its 1-3% band (https://www.bankofcanada.ca/core-functions/monetary-policy/inflation/, read 2026-10-22). The teacher can change it (0% to 10%).
//   Config: options.rates.inflationBp. The index starts at 10000 (1.0000) and every module scales its OWN prices by it (see docs/phase2.md, "Inflation").
export const INFLATION_BP = 210;
export const MAX_INFLATION_BP = 1000;
export const INDEX_BASE_BP = 10000;
