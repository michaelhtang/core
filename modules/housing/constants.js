// housing: every constant in one place, each with its source and the date it was checked (2026-10-22).
// Marked ILLUSTRATIVE where no page confirmed it. Money is integer cents; rates are basis points (1 bp = 0.01%).
export const SOURCES_CHECKED = '2026-10-22';

// ---- Rent tiers and the condo (read from here at run time, so an edit applies on restart; the old housing_catalogue table is dropped) ----
// 1-bedroom $1,290: Rentals.ca March 2026 $1,288 and Nesto June 2026 $1,292 (figures from the spec); on 2026-10-22 the Nesto page
//   https://www.nesto.ca/real-estate/edmonton-housing-market-outlook/ showed August 2026 1-bed $1,275, 2-bed $1,646, all-unit average $1,631.
// 2-bedroom $1,635: the spec's Nesto / Rentals.ca 2026 figure (August 2026 Nesto: $1,646). The roommate split is half of it: ILLUSTRATIVE.
// Shared room: the bills catalogue's rent line ($750), so housing adds nothing for it.
// Living with parents $400: a monthly household contribution instead of rent, no damage deposit (depositCents 0). ILLUSTRATIVE, anchored on the
//   Globe and Mail "Carrick on Money" reader poll of 960 parents (survey ran June 15, 2023; article June 25, 2023): just over half said their adult children
//   pay rent, and of those 52% charge $500 or less a month, 27% $501-$1,000, many calling it symbolic
//   (https://www.theglobeandmail.com/investing/personal-finance/young-money/article-charging-adult-children-rent, read 2026-10-22). Not a representative
//   survey and no 2026 Canadian/Alberta figure was found (StatCan has no published average), so $400 is a round figure inside the most common band.
// Roommate: "2-bedroom with a roommate" is its own tenure, key apt2-roommate: half the 2-bedroom rent, and its deposit is that same half (one month of
//   the student's own rent). Key kept from Wave 2b so existing tenure rows still work.
export const RENTALS = [
  { id: 'parents', name: 'Living with my parents (household contribution)', rentCents: 40000, depositCents: 0, lineName: 'Household contribution (living with parents)', note: 'Monthly contribution to the household, no deposit. Illustrative: 52% of rent-charging parents ask $500 or less (Globe and Mail Carrick on Money poll, June 2023, theglobeandmail.com/investing/personal-finance/young-money/article-charging-adult-children-rent), checked 2026-10-22' },
  { id: 'apt1', name: '1-bedroom apartment', rentCents: 129000, note: 'Edmonton average 1-bedroom: Rentals.ca March 2026 $1,288, Nesto June 2026 $1,292 (nesto.ca/real-estate/edmonton-housing-market-outlook/), checked 2026-10-22' },
  { id: 'apt2', name: '2-bedroom apartment', rentCents: 163500, note: 'Edmonton average 2-bedroom, Nesto / Rentals.ca 2026 (Nesto August 2026: $1,646), checked 2026-10-22' },
  { id: 'apt2-roommate', name: '2-bedroom with a roommate', rentCents: 81750, note: 'You share a 2-bedroom and pay half of the average rent ($1,635 / 2); your own deposit is one month of your half. Illustrative split' },
];

// Properties for sale. 'average' is the Edmonton average condo; 'starter' an older 1-bedroom. Both use the same mortgage rules.
// Condo: list price $202,000 = Edmonton average condo sale price, June 2026 (Nesto, citing the Realtors Association of Edmonton, which
// gave $202,000; the Nesto page read on 2026-10-22 had moved on to July $200,100 and August $199,100). Overridable: config.options.housing.condoPriceCents.
export const CONDO_PRICE_CENTS = 20200000;
export const MAX_PRICE_CENTS = 150000000;          // $1.5M: the insured-mortgage cap (see MORTGAGE below), so the game stops there
// Starter condo: an older Edmonton 1-bedroom, $150,000. Real 2026 listings, all in one 1970 building at 9725 106 Street NW, checked 2026-10-22
//   (listing pages are not stable links): unit 602 listed $149,900 with a $546/month condo fee; unit 403 listed $129,900, same $546 fee, "all utilities
//   included except cable/internet" (so heat, water/sewer and electricity are in the fee); unit 1002 (rew.ca/properties/1002-9725-106-street-edmonton-ab)
//   confirms the building's 1-bed units are ~778 sq ft, built 1970. Not re-checked: a $160,000 listing in the same building, a 1967 downtown 1-bedroom
//   with a $355 fee, and a newer 2008 1-bedroom at $149,900 with a $383 fee. Market context: RAE August 2026
//   apartment-condominium average $215,422 (nesto.ca/real-estate/edmonton-housing-market-outlook/). So an older 1-bedroom at $150,000 with a $546 fee
//   that already includes heat (so the heating line is $0) and power is a fair starter. Overridable: options.housing.starterPriceCents / starterFeeCents.
export const STARTER_PRICE_CENTS = 15000000;
export const STARTER_FEE_CENTS = 54600;            // older building, higher fee; includes heat, water and electricity
export const STARTER_HEATING_CENTS = 0;            // in the fee
export const CONDO_FEE_CENTS = 40000;              // $400/month, ILLUSTRATIVE
export const HOME_INSURANCE_CENTS = 3500;          // $35/month condo-unit policy, ILLUSTRATIVE
export const HEATING_CENTS = 6000;                 // $60/month natural gas for a condo, ILLUSTRATIVE (power and water are bills' utilities line)

// Property tax: 0.0103637 a year on the value, billed monthly as 1/12. City of Edmonton, 2026 Property Tax and Supplementary Property Tax Bylaw 21442:
// residential total 0.0103637 (municipal 0.0077419 + education 0.0025409 + education requisition allowance 0.0000809), up from 0.0101391 in 2025.
// The City's rate table was confirmed through a web search summary on 2026-10-22 (edmonton.ca/city_government/bylaws/bylaws-t); the bylaw PDF itself
// returned a 502 that day, so the figure is as the spec gave it and the search result confirmed. In parts per 10 million to stay integer.
export const PROPERTY_TAX_PER_10M = 103637;

// ---- Mortgage rules ----
// Minimum down payment: 5% of the first $500,000 + 10% of the part from $500,000 to $1,500,000; 20% from $1.5M (not insurable).
//   Insured-mortgage price cap raised from $1M to $1.5M on December 15, 2024. Source: Department of Finance Canada, "Government announces mortgage
//   reform details..." (canada.ca/en/department-finance/news/2024/09/government-announces-mortgage-reform-details-to-ensure-canadians-can-access-lower-monthly-mortgage-payments-by-december-15.html),
//   read 2026-10-22 (cap, 30-year); the 5% / 10% tiers are confirmed by CMHC and broker pages (that page itself only says "up to 95 per cent of the purchase price").
export const DOWN = { tier1Cents: 50000000, tier1Pct: 5, tier2Pct: 10, capCents: 150000000, uninsuredPct: 20 };

// CMHC premium on the total loan, by loan-to-value (the premium is added to the loan). Source: CMHC "Mortgage loan insurance cost" table,
// https://www.cmhc-schl.gc.ca/en/finance-and-investing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/cmhc-mortgage-loan-insurance-cost
// (page dated 2018, copyright 2026; read 2026-10-22). [maxLtv %, premium bp]. In this game 5-9.99% down = 90.01-95% LTV = 4.00%, and so on.
export const PREMIUM_BP = [[65, 60], [75, 170], [80, 240], [85, 280], [90, 310], [95, 400]];
// 30-year amortization on an insured mortgage adds 20 bp to the premium. Source: CMHC notice "CMHC revises homeowner mortgage loan insurance
// premiums" (cmhc-schl.gc.ca/media-newsroom/notices/2024/cmhc-revises-homeowner-mortgage-loan-insurance-premiums), confirmed: dated June 5, 2024, +0.20%
// for 30-year amortizations on insured mortgages.
export const SURCHARGE_30Y_BP = 20;

// Amortization: 25 years by default. SOURCES CONFLICT on 30: Budget 2024 first allowed it for first-time buyers of NEW BUILDS (Aug 1, 2024);
//   the Department of Finance's Sept 2024 release extends it to ALL first-time homebuyers and all new-build buyers from Dec 15, 2024 (read 2026-10-22).
//   Decision: the newer, primary source wins. 30 years is offered on an insured purchase to a first-time buyer, which in the game is a student with
//   no home yet in the current season (a condo is often new-build anyway). An uninsured purchase (20% down or more) may also pick 30, as lenders allow.
export const AMORT_DEFAULT_YEARS = 25;
export const AMORT_LONG_YEARS = 30;
export const TERM_MONTHS = 60;                      // 5-year fixed term, in world months (config.options.housing.termMonths overrides it, for a class demo)

// Stress test: qualify at max(contract rate + 2%, 5.25%). Source: OSFI, "Minimum qualifying rate for uninsured mortgages" (the greater of the contract
//   rate plus 2% or 5.25%; page updated 2026-01-29, read 2026-10-22), and CMHC's insured criteria use the same stress rate (via a 2026-10-22 search summary).
export const STRESS = { bufferBp: 200, floorBp: 525 };
// Debt service limits: GDS 39%, TDS 44%. Source: CMHC homeownership eligibility pages / CMHC 2021 notice "CMHC reviews underwriting criteria"
//   (cmhc-schl.gc.ca/media-newsroom/notices/2021/cmhc-reviews-underwriting-criteria), via a search summary on 2026-10-22 (page not opened).
export const GDS_MAX = 0.39, TDS_MAX = 0.44;
export const INCOME_WINDOW_MONTHS = 3;              // gross income = average of the last 3 months from jobs.paid

// ---- Closing, selling, penalties ----
export const LEGAL_FEE_CENTS = 150000;              // $1,500 each way, ILLUSTRATIVE
// Alberta Land Titles: $5 per $5,000 of value (or part) for a transfer of land and for a mortgage registration, plus a $50 base fee.
// Source: alberta.ca/register-land-title-document-plan.aspx (Land Titles Registration Levy in force Oct 20, 2024; the page gives the $5 per $5,000 but no
// base fee) and Bennett Jones, "Open Your Wallets Wider" (Oct 2024; $50 base + $5 per $5,000). Checked 2026-10-22. "Or part" is this game's reading.
export const LAND_TITLES = { baseCents: 5000, perBlockCents: 500, blockCents: 500000 };
export const COMMISSION_PCT = 4;                    // realtor commission on selling, ILLUSTRATIVE (the spec's figure)
export const NSF_FEE_CENTS = 4500;                  // $45 when a mortgage debit bounces, ILLUSTRATIVE
export const WARN_MISSED_IN_A_ROW = 3;              // teacher warning at this many missed payments in a row (no foreclosure in the pilot)

// ---- Market ----
export const DRIFT_BP = 25;                         // +0.25% a world month, ILLUSTRATIVE (the spec's default)
export const MARKET_EVENT_MIN_PCT = 5, MARKET_EVENT_MAX_PCT = 15;   // the world teacher's event: +/-5 to 15% on every home

// Rate when `rates` is not loaded: 5-year fixed 4.20% (see modules/rates/constants.js for its source).
export const DEFAULT_MORTGAGE_BP = 420;

// ---- Student landlords (wave 6b, docs/phase6-roles.md §2) ----
// A rental is an investment property: 20% down, because CMHC insures only homes the owner lives in (the uninsured minimum, same 20% as DOWN.uninsuredPct).
export const RENTAL_DOWN_PCT = 20;
// Lenders count part of a rental's expected rent as income (a "rental offset"); half is the usual figure and the spec's. ILLUSTRATIVE.
export const RENT_INCOME_PCT = 50;
// A student's rent must sit between 60% and 150% of the NPC rent tier for that property (the spec's bound: the only thing that stops rent being a
// transfer channel between students). The starter 1-bedroom compares with the 1-bedroom apartment, the average condo with the 2-bedroom.
export const RENT_MIN_PCT = 60, RENT_MAX_PCT = 150;
export const RENT_TIER = { starter: 'apt1', average: 'apt2' };
export const RENT_NOTICE_MONTHS = 2;                // a rent change applies two world months after it is announced (Alberta: 3 months; shortened for class)
export const END_NOTICE_MONTHS = 1;                 // a landlord ends a tenancy with one month's notice
export const EVICT_AFTER_MISSED = 3;                // three missed rent months in a row: eviction to the shared room
