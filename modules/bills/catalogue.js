// Every number the bills module uses lives here, each with where it came from and the day it was checked (2026-10-22).
// `illustrative: 1` means the source page could not be read directly, so the figure is a plausible estimate, not a quote.
// The catalogue is upserted into bills_catalogue at every boot (docs/modules.md "Catalogues"): edit it here and restart.
// Amounts can also be overridden per deployment with config.options.bills.amounts = { "<id>": cents }.
//
// slot/option: required bills (required: 1) are always billed. An optional slot (phone, internet, transport) bills the rows of
// the option the student chose; with no choice the FIRST option of the slot (lowest sort) applies; 'none' bills nothing.
// category is for the 50/30/20 bar: 'needs' or 'wants' (what is left after bills counts as savings).
//
// Balance check (docs/phase1.md "Balance", 2026-10-22): the defaults below (rent $750, utilities $120, groceries $366, phone-lite $24,
// internet $25, ETS $100 = $1,385 a month) land at 69% of the median bot's net pay ($2,013.41), inside the 60-85% target, and the cheapest
// job (cashier, $1,657 net) still covers them. No default was tuned for balance, so there is nothing to undo.
const CHECKED = '2026-10-22';

export const ITEMS = [
  { id: 'rent', slot: 'rent', option: 'room', option_label: 'Room in a shared house', name: 'Rent (room in a shared house)', amount_cents: 75000, required: 1, category: 'needs', sort: 10, illustrative: 1,
    source_note: 'Rentals.ca Edmonton room listings ask roughly $600 to $1,050 a month; whole-unit averages are $1,288 (1 bedroom) and $1,589 (all rentals), March 2026. The listing page itself returned 403, so the $750 midpoint is illustrative.',
    source_url: 'https://rentals.ca/edmonton/rooms' },
  { id: 'utilities', slot: 'utilities', option: 'share', option_label: 'Utilities share', name: 'Utilities (power, heat, water share)', amount_cents: 12000, required: 1, category: 'needs', sort: 20, illustrative: 1,
    source_note: 'Edmonton renters report about $50 to $90 a month for electricity and more where heat and water are billed separately (r/Edmonton thread, Feb 2026, anecdotal). EPCOR pages returned 404/no typical-bill figure, so $120 for a roommate share is illustrative.',
    source_url: 'https://www.epcor.com/' },
  { id: 'groceries', slot: 'groceries', option: 'food', option_label: 'Groceries', name: 'Groceries', amount_cents: 36600, required: 1, category: 'needs', sort: 30, illustrative: 0,
    source_note: 'Canada\'s Food Price Report 2026 (Dalhousie/Arrell Food Institute): family of four expected to spend up to $17,571.79 a year on food. Divided by 4 people and 12 months = $366.08 per person per month (our arithmetic; the report gives no per-person figure).',
    source_url: 'https://arrellfoodinstitute.ca/food-price-report-2026/' },
  { id: 'phone-lite', slot: 'phone', option: 'lite', option_label: 'Prepaid, 5 GB', name: 'Phone plan (prepaid, 5 GB)', amount_cents: 2400, required: 0, category: 'needs', sort: 40, illustrative: 0,
    source_note: 'Public Mobile prepaid: $24 a month for 5 GB (4G), as listed in iPhone in Canada\'s September 12, 2026 plan comparison.',
    source_url: 'https://www.iphoneincanada.ca/2026/09/12/public-mobile-vs-lucky-vs-chatr-vs-fizz-best-cellphone-plans-september-2026/' },
  { id: 'phone-plus', slot: 'phone', option: 'plus', option_label: 'Prepaid, 50 GB 5G', name: 'Phone plan (prepaid, 50 GB 5G)', amount_cents: 3500, required: 0, category: 'needs', sort: 41, illustrative: 0,
    source_note: 'Public Mobile prepaid: $35 a month for 50 GB (5G, Canada-wide), same September 12, 2026 comparison.',
    source_url: 'https://www.iphoneincanada.ca/2026/09/12/public-mobile-vs-lucky-vs-chatr-vs-fizz-best-cellphone-plans-september-2026/' },
  { id: 'internet', slot: 'internet', option: 'share', option_label: 'Share the house internet', name: 'Internet (share of the house plan)', amount_cents: 2500, required: 0, category: 'wants', sort: 50, illustrative: 1,
    source_note: 'No carrier page read. Illustrative: about a third of a roughly $75 a month home plan.',
    source_url: '' },
  { id: 'transit', slot: 'transport', option: 'ets', option_label: 'ETS monthly pass', name: 'Transit (ETS adult monthly pass)', amount_cents: 10000, required: 0, category: 'needs', sort: 60, illustrative: 1,
    source_note: 'Edmonton Transit Service adult monthly pass is about $100 per WelcomeAide\'s 2026 transit comparison (Feb 28, 2026). The official ETS fares page returned HTTP 502, so this is a secondary source and counted illustrative.',
    source_url: 'https://www.edmonton.ca/ets' },
  { id: 'car-insurance', slot: 'transport', option: 'car', option_label: 'Car (insurance + gas)', name: 'Car insurance', amount_cents: 18000, required: 0, category: 'needs', sort: 61, illustrative: 1,
    source_note: 'No insurer page read. Illustrative: a young Alberta driver\'s monthly premium on an older car.',
    source_url: '' },
  { id: 'car-gas', slot: 'transport', option: 'car', option_label: 'Car (insurance + gas)', name: 'Car gas', amount_cents: 15000, required: 0, category: 'needs', sort: 62, illustrative: 1,
    source_note: 'No fuel-price page read. Illustrative: about 120 L a month of regular.',
    source_url: '' },

  // ---- Stage costs (docs/stagecosts.md): billed only while the world's age is from_age..to_age (life.age; never without the life module), so months 1-168
  // (Stage A, ages 22-35) bill exactly what they did before. Season-start dollars x the price index, like every line above. tenure: 'own' = only a student
  // living in a home they own this month (housing's property-tax line), 'rent' = everyone else, '' = everyone. A slot's default is its first option (lowest
  // sort), so a student who never opens Plans pays the modest tier; 'None' is always offered for an optional slot. Age steps are separate rows of the same
  // slot/option with consecutive age ranges. Orders of magnitude: Statistics Canada, Survey of Household Spending 2019 (table 11-10-0222-01: average
  // household spending on transportation, health care, household furnishings and operation, recreation and travel). No figure below is a quote of a
  // StatCan number: each is ILLUSTRATIVE, a round monthly amount in that range for one adult's share of a household.
  { id: 'household-modest', slot: 'household', option: 'modest', option_label: 'Growing household (modest)', name: 'Household growth (modest)', amount_cents: 45000, required: 0, category: 'needs', sort: 70, illustrative: 1, from_age: 36, to_age: 54,
    source_note: 'ILLUSTRATIVE. A bigger household in your thirties and forties: a partner or dependants, more food, clothing, activities and space. Statistics Canada\'s Survey of Household Spending puts a family household\'s yearly spending well above a single person\'s (tens of thousands of dollars a year more); this line is your share of the extra.',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'household-full', slot: 'household', option: 'full', option_label: 'Family with children (childcare, activities)', name: 'Household growth (family with children)', amount_cents: 110000, required: 0, category: 'needs', sort: 71, illustrative: 1, from_age: 36, to_age: 54,
    source_note: 'ILLUSTRATIVE. Raising children: childcare, food, clothing, activities, school costs. Alberta\'s regulated childcare is a few hundred dollars a month per child under the federal-provincial agreement, and older children cost more in food and activities; this line is a plain round figure for your share.',
    source_url: 'https://www.alberta.ca/federal-provincial-child-care-agreement' },
  { id: 'vehicle-used', slot: 'vehicle', option: 'used', option_label: 'Replace with a used car', name: 'Vehicle replacement and upkeep (used car)', amount_cents: 25000, required: 0, category: 'needs', sort: 80, illustrative: 1, from_age: 36, to_age: 54,
    source_note: 'ILLUSTRATIVE. Putting money aside to replace a family vehicle with a used one about every 8 years, plus tires, repairs and maintenance. Statistics Canada\'s household spending survey shows vehicle purchases and upkeep as one of the largest yearly costs of a household. Choose None if you will not own a vehicle.',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'vehicle-new', slot: 'vehicle', option: 'new', option_label: 'Replace with a new car', name: 'Vehicle replacement and upkeep (new car)', amount_cents: 60000, required: 0, category: 'wants', sort: 81, illustrative: 1, from_age: 36, to_age: 54,
    source_note: 'ILLUSTRATIVE. Saving for a new vehicle about every 8 years (or the loan payments on one), plus upkeep.',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'home-upkeep', slot: 'home-upkeep', option: 'own', option_label: 'Home upkeep', name: 'Home upkeep and repairs (owner)', amount_cents: 15000, required: 1, category: 'needs', sort: 90, illustrative: 1, from_age: 36, to_age: 99, tenure: 'own',
    source_note: 'ILLUSTRATIVE. Owners pay for repairs and replacements a landlord would otherwise cover: appliances, flooring, a special assessment. A common rule of thumb is about 1% of the home\'s value a year; this is a round monthly figure below that, as condo fees already cover the building.',
    source_url: '' },
  { id: 'renter-extras', slot: 'home-upkeep', option: 'rent', option_label: 'Renter extras', name: 'Household furnishings and supplies (renter)', amount_cents: 7500, required: 1, category: 'needs', sort: 91, illustrative: 1, from_age: 36, to_age: 99, tenure: 'rent',
    source_note: 'ILLUSTRATIVE. Renters do not pay for repairs, but still replace furniture, appliances they own and household supplies as the household grows (Statistics Canada: household furnishings and equipment, household operation).',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'health-55', slot: 'health', option: 'care', option_label: 'Health and care', name: 'Health and care (dental, vision, prescriptions)', amount_cents: 15000, required: 1, category: 'needs', sort: 100, illustrative: 1, from_age: 55, to_age: 59,
    source_note: 'ILLUSTRATIVE. Costs public health care does not cover rise with age: dental, glasses and hearing, prescriptions, and the premiums of a health plan once an employer plan ends. Statistics Canada\'s household spending survey shows direct health care spending growing in older households. It steps up every five years: 55, 60, 65.',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'health-60', slot: 'health', option: 'care', option_label: 'Health and care', name: 'Health and care (dental, vision, prescriptions)', amount_cents: 21000, required: 1, category: 'needs', sort: 101, illustrative: 1, from_age: 60, to_age: 64,
    source_note: 'ILLUSTRATIVE. The age 60 step of the health and care line (see age 55).', source_url: '' },
  { id: 'health-65', slot: 'health', option: 'care', option_label: 'Health and care', name: 'Health and care (dental, vision, prescriptions)', amount_cents: 28000, required: 1, category: 'needs', sort: 102, illustrative: 1, from_age: 65, to_age: 99,
    source_note: 'ILLUSTRATIVE. The age 65 step of the health and care line: more prescriptions, hearing aids, home help now and then.', source_url: '' },
  { id: 'travel-modest', slot: 'travel', option: 'modest', option_label: 'Some travel and hobbies', name: 'Travel and leisure (some)', amount_cents: 20000, required: 0, category: 'wants', sort: 110, illustrative: 1, from_age: 55, to_age: 99,
    source_note: 'ILLUSTRATIVE. Visiting family, a trip a year, hobbies: what people plan to do with the time retirement frees up (Statistics Canada: recreation and travel tours).',
    source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201' },
  { id: 'travel-full', slot: 'travel', option: 'full', option_label: 'Travel often', name: 'Travel and leisure (often)', amount_cents: 60000, required: 0, category: 'wants', sort: 111, illustrative: 1, from_age: 55, to_age: 99,
    source_note: 'ILLUSTRATIVE. Several trips a year, a winter away, bigger hobbies.', source_url: '' },
].map((i) => ({ checked: CHECKED, from_age: 0, to_age: 99, tenure: '', ...i }));
// The stage rows were added on this date (their notes were written then); the rows above keep their own.
for (const i of ITEMS) if (i.from_age > 0) i.checked = '2026-10-30';

export const SLOT_LABELS = { phone: 'Phone plan', internet: 'Internet', transport: 'Getting around', household: 'Household growth', vehicle: 'Vehicle replacement and upkeep', travel: 'Travel and leisure' };
// The rows that bill at an age (age null: no life module, so Stage A only), for a tenure (owner: lives in a home they own this month).
export const forAge = (items, age, owner) => items.filter((r) => r.from_age <= (age ?? 0) && (age ?? 0) <= r.to_age && (!r.tenure || (r.tenure === 'own') === !!owner));

export const LATE_FEE = { cents: 2500, pct: 5 };      // greater of $25 or 5% of the bill (project spec; config.options.bills.lateFeeCents / lateFeePct override)
export const TARGETS = { needs: 50, wants: 30, savings: 20 };   // the 50/30/20 budgeting rule of thumb

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const seedSql = () => ITEMS.map((i) =>
  `INSERT INTO bills_catalogue (id, slot, option, option_label, name, amount_cents, required, category, sort, source_note, source_url, checked, illustrative) VALUES (${[
    q(i.id), q(i.slot), q(i.option), q(i.option_label), q(i.name), i.amount_cents, i.required, q(i.category), i.sort, q(i.source_note), q(i.source_url), q(i.checked), i.illustrative].join(', ')});`).join('\n');
