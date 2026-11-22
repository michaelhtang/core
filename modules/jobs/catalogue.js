// The Job Centre catalogue: twelve entry-level Alberta jobs. Employers are fictional DAA-town businesses.
// Wage source: ALIS (alis.alberta.ca) occupation profiles, "Wage & Salary" table from the 2023 Alberta Wage and Salary Survey,
// all industries and regions, hourly wage of employees who are STARTING in the occupation (the "Starting / Average" cell), checked 2026-10-22.
// Hours per month = the profile's average weekly hours x 52 / 12, kept inside 80..160 (every row is at or above Alberta's $15.00/h minimum).
// requires_note says where a row's wage comes from when it is not the profile of the same name:
//   ''                                   the ALIS profile of this very occupation
//   'wage from related ALIS profile: X'  ALIS has no profile for this exact job; X is the closest one (named in the note)
//   'wage derived: ...'                  computed from an ALIS figure (shown in the note)
//   'wage illustrative'                  no ALIS wage page covers this job; the wage is an illustration, not a source figure
// The floor for a student company's wage (wave 4b): Alberta's general minimum wage, $15.00 an hour (https://www.alberta.ca/minimum-wage), the
// same floor as every catalogue row (CHECK hourly_cents >= 1500). Business jobs are part-time paid hours ON TOP of the catalogue job (6c,
// Mr. Tang 2026-10-23): 10 to 40 hours a month each, at most 2 of them and 40 hours in all.
export const MIN_WAGE_CENTS = 1500, BUSINESS_MIN_HOURS = 10, BUSINESS_MAX_HOURS = 40, BUSINESS_MAX_JOBS = 2;
const ALIS = 'https://alis.alberta.ca/occinfo/occupations-in-alberta/occupation-profiles/';
const CHECKED = '2026-10-22';
const row = (id, title, employer, hourly_cents, hours_per_month, slug, requires_note = '') => ({ id, title, employer, hourly_cents, hours_per_month, requires_note, alis_url: `${ALIS}${slug}/`, checked: CHECKED });

export const CATALOGUE = [
  row(1, 'Cashier', 'Corner Mart', 1528, 118, 'cashier'),                                                           // Starting avg $15.28; 27.3 h/wk (NOC 65100)
  row(2, 'Line cook', 'Maple Street Grill', 1687, 136, 'cook'),                                                     // $16.87; 31.4 h/wk (NOC 63200)
  row(3, 'Barista', 'Agora Coffee Co.', 1527, 113, 'food-and-beverage-server', 'wage from related ALIS profile: Food and Beverage Server (NOC 65200)'),   // $15.27; 26.1 h/wk
  row(4, 'Retail associate', 'Prairie Threads', 1706, 132, 'retail-salesperson'),                                   // $17.06; 30.5 h/wk (NOC 64100)
  row(5, 'Lifeguard', 'Riverbend Aquatic Centre', 1865, 102, 'sports-instructor', 'wage from related ALIS profile: Sports Instructor (NOC 54100, program leaders and instructors in recreation, sport and fitness)'),   // $18.65; 23.5 h/wk
  row(6, 'Warehouse associate', 'Keystone Distribution', 1545, 132, 'retail-shelf-stocker', 'wage from related ALIS profile: Retail Shelf Stocker (NOC 65102, store shelf stockers, clerks and order fillers)'),   // $15.45; 30.4 h/wk
  row(7, 'Daycare assistant', 'Little Sprouts Daycare', 1673, 159, 'early-childhood-educator', 'wage from related ALIS profile: Early Childhood Educator (NOC 42202, educators and assistants)'),   // $16.73; 36.8 h/wk
  row(8, 'Apprentice electrician (1st period)', 'Spark Line Electric', 1679, 160, 'electrician', 'wage derived: 50% of the ALIS starting wage $33.58; ALIS says first-year apprentices earn at least 50% of the journeyperson rate'),   // 0.5 x 33.58; 41.2 h/wk = 178 h, capped at 160
  row(9, 'Administrative assistant', 'Beacon Business Services', 2279, 153, 'administrative-assistant'),            // $22.79; 35.3 h/wk (NOC 13110)
  row(10, 'Junior bookkeeper', 'Ledgerline Accounting', 2398, 147, 'accounting-technician', 'wage from related ALIS profile: Accounting Technician (ALIS lists Bookkeeper as an alternative title; NOC 12200)'),   // $23.98; 34 h/wk
  row(11, 'Customer service rep', 'Callpoint Support', 2147, 159, 'call-centre-agent', 'wage from related ALIS profile: Call Centre Agent (ALIS lists Customer Service Representative as an alternative title; NOC 64409)'),   // $21.47; 36.7 h/wk
  row(12, 'Landscaper', 'Greenbelt Landscaping', 1600, 120, 'landscape-horticulturist', 'wage illustrative'),         // ALIS has no landscaping-labourer profile (its Landscape Horticulturist is a trade); URL is the nearest page
];

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const seedSql = () => `INSERT INTO jobs_catalogue (id, title, employer, hourly_cents, hours_per_month, requires_note, alis_url, checked) VALUES\n${
  CATALOGUE.map((c) => `(${c.id}, ${q(c.title)}, ${q(c.employer)}, ${c.hourly_cents}, ${c.hours_per_month}, ${q(c.requires_note)}, ${q(c.alis_url)}, ${q(c.checked)})`).join(',\n')};`;

// ---- Promotion paths (docs/jobs.md): 1 to 3 steps after the entry job, each with an ALIS wage (2023 Alberta Wage and Salary Survey, all industries, hourly, checked 2026-10-22).
// A profile's wage table has three average cells: Starting, Overall (experienced) and Top. Rule used here: a step in a NEW occupation starts at that occupation's
// ALIS "Starting" average; a step that is the same occupation with more experience uses its "Overall" (or "Top") average. The note on each row says which cell.
// Hours = ALIS average weekly hours x 52 / 12, kept inside 80..160. Employer stays the same fictional business: promotions are inside the firm.
const P = 'https://alis.alberta.ca/occinfo/occupations-in-alberta/occupation-profiles/';
const W = 'https://alis.alberta.ca/occinfo/wages-and-salaries-in-alberta/';
const hrs = (weekly) => Math.min(160, Math.max(80, Math.round((weekly * 52) / 12)));
const step = (job_id, step, title, hourly_cents, hours_per_month, url, note) => ({ job_id, step, title, hourly_cents, hours_per_month, alis_url: url, note, checked: CHECKED });
const SUPERVISOR = `${W}retail-sales-supervisors/62010/`;
const MANAGER = `${P}retail-store-manager/`;

export const PATHS = [
  step(1, 1, 'Retail supervisor', 1912, hrs(34.8), SUPERVISOR, 'ALIS Retail sales supervisors (NOC 62010), Starting $19.12; 34.8 h/wk. The Cashier profile says cashiers may advance to supervisory roles'),
  step(1, 2, 'Store manager', 2889, 160, MANAGER, 'ALIS Retail Store Manager, Starting $28.89; hours not published, 40 h/wk assumed (capped at 160 h/month)'),
  step(2, 1, 'Cook', 1862, hrs(31.4), `${P}cook/`, 'ALIS Cook (NOC 63200), Overall $18.62: the same occupation with experience; 31.4 h/wk'),
  step(2, 2, 'Chef', 2206, hrs(37.9), `${P}chef/`, 'ALIS Chef (NOC 62200), Starting $22.06; 37.9 h/wk = 164 h, capped at 160'),
  step(3, 1, 'Food service supervisor', 1754, hrs(34.8), `${P}food-service-supervisor/`, 'ALIS Food Service Supervisor (NOC 62020), Starting $17.54; 34.8 h/wk'),
  step(3, 2, 'Restaurant manager', 2120, 160, `${P}restaurant-manager/`, 'ALIS Restaurant Manager, Starting $21.20; 38.7 h/wk = 168 h, capped at 160'),
  step(4, 1, 'Senior retail associate', 2160, hrs(30.5), `${P}retail-salesperson/`, 'ALIS Retail Salesperson (NOC 64100), Overall $21.60: the same occupation with experience; 30.5 h/wk'),
  step(4, 2, 'Store manager', 2889, 160, MANAGER, 'ALIS Retail Store Manager, Starting $28.89; the profile of Retail Salesperson says experienced salespeople move into supervisory or management roles; 40 h/wk assumed'),
  step(5, 1, 'Head lifeguard', 2229, hrs(23.5), `${P}sports-instructor/`, 'ALIS Sports Instructor (NOC 54100), Overall $22.29: the same occupation with experience; 23.5 h/wk'),
  step(6, 1, 'Senior warehouse associate', 1793, hrs(30.4), `${P}retail-shelf-stocker/`, 'ALIS Retail Shelf Stocker (NOC 65102), Overall $17.93: the same occupation with experience; 30.4 h/wk'),
  step(6, 2, 'Warehouse lead hand', 2148, hrs(30.4), `${P}retail-shelf-stocker/`, 'ALIS Retail Shelf Stocker, Top $21.48 (ALIS has no warehouse lead-hand profile; the Top cell stands in for an experienced lead)'),
  step(7, 1, 'Early childhood educator', 1905, hrs(36.8), `${P}early-childhood-educator/`, 'ALIS Early Childhood Educator (NOC 42202), Overall $19.05; 36.8 h/wk'),
  step(7, 2, 'Child care supervisor', 2381, hrs(36.8), `${P}early-childhood-educator/`, 'ALIS Early Childhood Educator, Top $23.81 (the profile says experienced educators move into supervisory roles; no separate supervisor wage, so the Top cell stands in)'),
  step(8, 1, 'Apprentice electrician (2nd period)', 2015, 160, `${P}electrician/`, 'ALIS Electrician: apprentices earn at least 60% of the journeyperson wage in the second year; 60% of the ALIS starting wage $33.58'),
  step(8, 2, 'Apprentice electrician (3rd period)', 2351, 160, `${P}electrician/`, 'ALIS Electrician: at least 70% in the third year; 70% of $33.58'),
  step(8, 3, 'Apprentice electrician (4th period)', 2686, 160, `${P}electrician/`, 'ALIS Electrician: at least 80% in the fourth year; 80% of $33.58'),
  step(9, 1, 'Senior administrative assistant', 2725, hrs(35.3), `${P}administrative-assistant/`, 'ALIS Administrative Assistant (NOC 13110), Overall $27.25: the same occupation with experience; 35.3 h/wk'),
  step(9, 2, 'Office manager', 3102, hrs(35.3), `${P}administrative-assistant/`, 'ALIS Administrative Assistant, Top $31.02 (the profile says experienced assistants may supervise other office assistants; ALIS has no office-manager wage, so the Top cell stands in)'),
  step(10, 1, 'Bookkeeper', 2984, hrs(34), `${P}accounting-technician/`, 'ALIS Accounting Technician (alternative title Bookkeeper; NOC 12200), Overall $29.84; 34 h/wk'),
  step(10, 2, 'Accounting technician', 3537, hrs(34), `${P}accounting-technician/`, 'ALIS Accounting Technician, Top $35.37'),
  step(11, 1, 'Senior customer service rep', 2552, hrs(36.7), `${P}call-centre-agent/`, 'ALIS Call Centre Agent (NOC 64409), Overall $25.52; 36.7 h/wk'),
  step(11, 2, 'Customer service team lead', 3025, hrs(36.7), `${P}call-centre-agent/`, 'ALIS Call Centre Agent, Top $30.25 (the profile says experienced operators may move into supervisory or training roles; the Top cell stands in)'),
  step(12, 1, 'Landscape technician', 2152, 160, `${P}landscape-horticulturist/`, 'ALIS Landscape Horticulturist (page notes its wages cover the broader landscape and horticulture technicians group), Starting $21.52; 39.9 h/wk = 173 h, capped at 160'),
  step(12, 2, 'Landscape crew supervisor', 2462, 160, `${P}landscape-horticulturist/`, 'ALIS Landscape Horticulturist, Overall $24.62 (the profile says experienced workers may advance to supervisor)'),
];

export const stepsSql = () => `INSERT INTO jobs_steps (job_id, step, title, hourly_cents, hours_per_month, alis_url, note, checked) VALUES\n${
  PATHS.map((c) => `(${c.job_id}, ${c.step}, ${q(c.title)}, ${c.hourly_cents}, ${c.hours_per_month}, ${q(c.alis_url)}, ${q(c.note)}, ${q(c.checked)})`).join(',\n')};`;
