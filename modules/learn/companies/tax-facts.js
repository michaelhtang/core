// The pinned source of REAL Canadian tax facts for the FinTech 20 tax section of the Learning Road (Alberta high school).
// Lesson writers may quote ONLY what this file holds. Nothing here was written from memory: every fact was read from an official
// Government of Canada (canada.ca, including CRA and Service Canada pages) or Government of Alberta (alberta.ca) page on READ below,
// and its `quote` was checked against the fetched page text.
//
// DRAFT: every fact awaits Mr. Tang's confirmation before any student sees it. Many values change by year (rates, deadlines, slip
// and line names, federal spending): each year-specific fact carries a `year`; recheck them every tax season.
//
// A fact is { value, say, quote, url, read, year? }
//   value  the fact as data        say  one plain sentence (our wording) for a Grade 10 reader
//   quote  exact words from the page (25 words or fewer; whitespace as on the page)    url  the page    read  the date it was read
// Facts left out are listed in MISSING (with what was tried). Pages that disagree are listed in CONFLICTS and left out.

export const READ = '2026-11-15';
const f = (value, say, quote, url, year) => ({ value, say, quote, url, read: READ, ...(year ? { year } : {}) });

const CRA = 'https://www.canada.ca/en/revenue-agency';
const TAXES = `${CRA}/services/tax/individuals`;
const T1 = `${TAXES}/topics/about-your-tax-return/tax-return/completing-a-tax-return`;
const PURPOSE = `${TAXES}/educational-programs/purpose-taxes.html`;
const RATES = `${CRA}/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html`;
const GUIDE = `${CRA}/services/forms-publications/tax-packages-years/general-income-tax-benefit-package/5000-g.html`;
const T4_SLIP = `${T1}/tax-slips/understand-your-tax-slips/t4-slips/t4-statement-remuneration-paid.html`;
const T4A_SLIP = `${T1}/tax-slips/understand-your-tax-slips/t4-slips/t4a-slip.html`;
const T5_SLIP = `${CRA}/services/tax/businesses/topics/completing-slips-summaries/financial-slips-summaries/return-investment-income-t5/t5-slip/completing-t5-slip.html`;
const SIN_APPLY = 'https://www.canada.ca/en/employment-social-development/services/sin/apply.html';
const SIN_PROTECT = 'https://www.canada.ca/en/employment-social-development/services/sin/protection.html';
const AFR = 'https://www.canada.ca/en/department-finance/services/publications/annual-financial-report/2026.html';
const TBOR = `${CRA}/corporate/about-canada-revenue-agency-cra/taxpayer-bill-rights.html`;
const SOFTWARE = 'https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax/how-file/tax-software.html';
const NETFILE = 'https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax/how-file/tax-software/send-return/netfile.html';
const GET_READY = 'https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax/get-ready-taxes.html';
const CAP_CALC = `${T1}/personal-income/line-12700-capital-gains/calculating-reporting-your-capital-gains-losses.html`;
const T4037 = `${CRA}/services/forms-publications/publications/t4037/capital-gains.html`;

// 1. KINDS of taxes (CRA "Purpose of taxes" lesson, plus the CRA excise page)
export const KINDS = {
  taxes: f('mandatory payments to a government', 'Taxes are payments you must make to a government, not a choice.', 'Taxes are mandatory payments made to a government.', PURPOSE),
  levels: f(['federal', 'provincial or territorial', 'municipal'], 'Three levels of government collect taxes: federal, provincial or territorial, and municipal.', 'In Canada, the federal, provincial or territorial, and municipal (local) levels of government all collect taxes.', PURPOSE),
  incomeTax: f('tax on income', 'Income tax is tax that individuals and businesses pay on their income.', 'Individuals and businesses pay taxes on their income.', PURPOSE),
  gst: f('GST: federal sales tax', 'The GST is a federal sales tax you pay on most things you buy in Canada.', 'goods and services tax (GST) A federal tax you pay on most goods and services you purchase in Canada.', PURPOSE),
  pst: f('PST: provincial sales tax', 'A PST is a sales tax that some provinces charge; the rate and the items taxed differ between provinces.', 'provincial sales tax (PST) A tax some provinces charge. The rate and the items they tax are different between provinces.', PURPOSE),
  hst: f('HST: GST and PST combined', 'In some provinces the GST and the provincial tax are combined into one tax called the HST.', 'harmonized sales tax (HST) A tax some provinces charge. These provinces combine the GST with the PST to form the HST.', PURPOSE),
  propertyTax: f('property tax: charged by municipalities on land and buildings', 'Property tax is charged by your city or town and is based on the value of land and buildings.', 'Property taxes Municipal (local) governments calculate these taxes based on the value of land and buildings.', PURPOSE),
  customs: f('customs duties or tariffs on imports and exports', 'Customs duties, also called tariffs, are charged by the federal government on some imported and exported goods.', 'Customs duties or tariffs The federal government charges these amounts on certain imported and exported products.', PURPOSE),
  exciseTaxes: f('excise taxes on certain goods, such as fuel-inefficient vehicles', 'Excise taxes are charged on some goods, such as fuel-inefficient vehicles.', 'Excise taxes are imposed on: fuel-inefficient vehicles including station wagons, vans and sport utility vehicles', `${CRA}/services/tax/businesses/small-businesses-self-employed-income/excise-taxes-excise-duties-softwood-lumber-products-export-charge-air-travellers-security-charge.html`),
  exciseFuels: f(['gasoline', 'diesel fuel', 'aviation gasoline', 'aviation fuel'], 'Gasoline and diesel fuel are on the CRA list of goods that carry excise tax.', 'and gasoline, diesel fuel, aviation gasoline, and aviation fuel', `${CRA}/services/tax/businesses/small-businesses-self-employed-income/excise-taxes-excise-duties-softwood-lumber-products-export-charge-air-travellers-security-charge.html`),
  exciseDuties: f('excise duties on alcohol, tobacco, cannabis and vaping products', 'Excise duties are charged on alcohol, tobacco, cannabis and vaping products.', 'Excise duties are charged on spirits, wine, beer, tobacco products, cannabis products and vaping products.', `${CRA}/services/tax/businesses/small-businesses-self-employed-income/excise-taxes-excise-duties-softwood-lumber-products-export-charge-air-travellers-security-charge.html`),
  payrollContributions: f(['EI', 'CPP'], 'CPP and EI contributions come off an employee\'s pay, and the employer adds contributions in the employee\'s name.', 'Your employer will deduct these contributions automatically and will also make contributions to these programs in your name.', PURPOSE),
  cpp: f('CPP: retirement pension', 'The Canada Pension Plan pays a retirement pension to people at least 60 years old who have made at least one valid contribution.', 'A retirement pension you could receive if you are at least 60 years old and have made at least one valid contribution to the CPP', PURPOSE),
  ei: f('EI: benefits for people who lose their job', 'Employment Insurance pays benefits to people who lose their jobs through no fault of their own.', 'This program provides benefits to individuals who lose their jobs through no fault of their own', PURPOSE),
  taxesPayFor: f(['education and schools', 'health care and hospitals', 'roads and bridges'], 'Taxes help pay for things like schools, hospitals, and roads.', 'Taxes help pay for: education and schools health care and hospitals roads and bridges police, ambulance, and fire services', PURPOSE),
};

// 2. SALES taxes. Rates come from the CRA GST/HST calculator (and rates) page. Percent.
export const SALES = {
  gstRate: f(5, 'The CRA rates table shows a 5 percent GST in Alberta.', 'Alberta 5% 0%', RATES),
  albertaNoPst: f('no provincial sales tax', 'Alberta does not charge a provincial sales tax.', 'No provincial sales tax', 'https://www.alberta.ca/life-in-alberta'),
  albertaPstRate: f(0, 'The CRA rates table shows 0 percent PST for Alberta.', 'Alberta 5% 0%', RATES),
  hst: {
    NB: f(15, 'New Brunswick charges a 15 percent HST.', 'New Brunswick 15% N/A', RATES),
    NL: f(15, 'Newfoundland and Labrador charges a 15 percent HST.', 'Newfoundland and Labrador 15% N/A', RATES),
    NS: f(14, 'Nova Scotia\'s HST rate went down to 14 percent on April 1, 2025.', 'As of April 1, 2025 , the HST rate has decreased to 14% in Nova Scotia.', RATES, 2025),
    ON: f(13, 'Ontario charges a 13 percent HST.', 'Ontario 13% N/A', RATES),
    PE: f(15, 'Prince Edward Island charges a 15 percent HST.', 'Prince Edward Island 15% N/A', RATES),
  },
  // The CRA table calls Quebec's tax a PST; the CRA "Purpose of taxes" page says Quebec's PST is called the Quebec sales tax (QST).
  pst: {
    BC: f(7, 'British Columbia charges a 7 percent PST on top of the 5 percent GST.', 'British Columbia 5% 7%', RATES),
    MB: f(7, 'Manitoba charges a 7 percent PST on top of the 5 percent GST.', 'Manitoba 5% 7%', RATES),
    QC: f(9.975, 'Quebec charges a 9.975 percent provincial tax on top of the 5 percent GST.', 'Quebec 5% 9.975%', RATES),
    SK: f(6, 'Saskatchewan charges a 6 percent PST on top of the 5 percent GST.', 'Saskatchewan 5% 6%', RATES),
  },
  ratesChanged: f('2025-04-01', 'Nova Scotia\'s HST rate went down to 14 percent on April 1, 2025.', 'As of April 1, 2025 , the HST rate has decreased to 14% in Nova Scotia.', RATES, 2025),
};

// 3. CAPITAL_GAINS
export const CAPITAL_GAINS = {
  whatIs: f('selling capital property', 'You usually have a capital gain or loss when you sell, or are treated as having sold, capital property.', 'Usually, you have a capital gain or capital loss when you sell or are considered to have sold capital property', CAP_CALC, 2025),
  gain: f('sold for more than ACB plus outlays and expenses of selling', 'It is a capital gain when you sell for more than the total of its ACB and the outlays and expenses of selling it.', 'for more than the total of its ACB and the outlays and expenses incurred to sell the property', CAP_CALC, 2025),
  inclusionRateMeaning: f('fraction of a gain that is taxed', 'The inclusion rate is the fraction of a capital gain that counts as income and gets taxed.', 'the fraction by which you multiply your capital gain, capital loss, or business investment loss for the year', T4037, 2025),
  inclusionRate2025: f(0.5, 'For 2025 the CRA says the inclusion rate is 50 percent, so half of a capital gain is taxable.', 'The inclusion rate for 2025 is 50%', T4037, 2025),
  proposedIncrease: f('two-thirds above $250,000 a year, planned from 2026-01-01', 'In 2025 the government planned to raise the rate to two-thirds on gains over $250,000 a year for individuals.', 'the inclusion rate will increase from one-half to two-thirds on capital gains realized in excess of $250,000 annually for individuals', `${CRA}/news/newsroom/tax-tips/tax-tips-2025/update-cra-administration-proposed-capital-gains-taxation-changes.html`, 2025),
  increaseCancelled: f('proposed increase cancelled', 'Budget 2025 documents describe the proposed increase in the capital gains inclusion rate as cancelled.', 'the cancellation of the proposed increase in the capital gains inclusion rate', 'https://budget.canada.ca/2025/report-rapport/anx1-en.html', 2025),
};

// 4. INHERITANCE (no official page was found that says Canada has no inheritance tax: see MISSING)
export const INHERITANCE = {
  deemedDisposition: f('treated as having sold all property just before death', 'When a person dies, the tax rules treat them as having sold their property just before death, which can create a capital gain on their final return.', 'When a person dies, they are considered to have sold all their property just prior to death', `${CRA}/services/tax/individuals/life-events/what-when-someone-died/deemed-disposition-property.html`),
  spouseException: f('no capital gain when property goes to a spouse or common-law partner', 'Property passed to a spouse or common-law partner is a main exception, so no gain is taxed at that time.', 'unless the property or asset is transferred to a spouse or common-law partner or a specific exception applies', `${CRA}/services/tax/individuals/life-events/what-when-someone-died/deemed-disposition-property.html`),
};

// 5. CRA
export const CRA_ROLE = {
  administers: f('federal, and most provincial and territorial, tax laws', 'The CRA runs tax laws for the federal government and for most provinces and territories.', 'The Canada Revenue Agency (CRA) administers tax laws for the Government of Canada and for most provinces and territories.', `${CRA}/corporate/about-canada-revenue-agency-cra.html`),
  alberta: f('CRA collects Alberta personal income tax', 'In Alberta, the CRA collects personal income tax together with federal income tax.', 'Alberta\'s personal income tax is collected by the Canada Revenue Agency at the same time federal income tax is collected.', 'https://www.alberta.ca/taxes-levies-overview'),
  benefitPrograms: f('benefit and incentive programs run through the tax system', 'The CRA also runs benefit and incentive programs through the tax system.', 'The CRA also administers social and economic benefit, and incentive programs delivered through the tax system.', `${CRA}/corporate/about-canada-revenue-agency-cra.html`),
  filingKeepsBenefits: f('file each year to keep getting benefits and credits', 'To get or keep getting benefit and credit payments, people must update their information with the CRA by filing a return each year.', 'continue to receive benefit and credit payments, individuals must update their information with the CRA each year by filing their income tax and benefit return', `${CRA}/corporate/about-canada-revenue-agency-cra/departmental-plan/2025-26-cra-departmental-plan.html`, '2025-26'),
  selfAssessment: f('each person does their own taxes every year', 'Canada\'s system relies on each person filing their own return every year.', 'In Canada, each person does their own taxes every year.', PURPOSE),
  cgeb: f('Canada Groceries and Essentials Benefit, formerly the GST/HST credit', 'The GST/HST credit is now called the Canada Groceries and Essentials Benefit and is paid every three months to eligible people.', 'the Canada Groceries and Essentials Benefit (CGEB) (formerly known as the GST/HST credit) A tax-free payment that eligible individuals get every three months.', PURPOSE),
};

// 6. SIN
export const SIN = {
  what: f('9-digit identifier needed to work and to use government programs', 'A SIN is a 9-digit number you need to work in Canada and to use government programs and benefits.', 'To work in Canada or access government programs and benefits, you need a 9-digit identifier known as Social Insurance Number (SIN).', 'https://www.canada.ca/en/employment-social-development/services/sin.html'),
  issuer: f('Service Canada', 'Service Canada issues the SIN.', 'Your Social Insurance Number (SIN) is a unique 9-digit number issued by Service Canada.', `${TAXES}/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-address-information/social-insurance-number.html`),
  whoCanApply: f('anyone 12 or older, for their own SIN', 'Anyone 12 or older can apply for their own SIN.', 'Anyone 12 years or older can apply for their own SIN', SIN_APPLY),
  applyForChild: f('a parent or legal guardian applies for a child under the age of majority', 'A parent or legal guardian can apply for a child under the age of majority.', 'children under the age of majority (the legal adult age in their province or territory), a parent or legal guardian can apply on their behalf', SIN_APPLY),
  howToApply: f(['online', 'by mail', 'in person'], 'You can apply for a SIN online, by mail, or in person.', 'How would you like to apply? Online By mail In person', SIN_APPLY),
  fee: f('no fee', 'It costs nothing to apply for a SIN.', 'There is no fee to apply for a SIN.', SIN_APPLY),
  primaryDocument: f('one primary identity document, for example a birth certificate', 'You must provide one primary identity document, and a birth certificate issued by a vital statistics agency is one choice.', 'You must provide 1 of the following documents: birth certificate issued by the vital statistics agency', SIN_APPLY),
  secondaryDocument: f(['passport', 'provincial or territorial ID card or driver\'s licence', 'other Canadian government-issued ID'], 'A secondary document can be a passport, a provincial or territorial ID card or driver\'s licence, or other Canadian government-issued ID.', 'a passport (Canadian or foreign) a Canadian provincial or territorial ID card or driver’s license any other Canadian government-issued ID', SIN_APPLY),
  secondaryDocumentAge: f('needed once you have reached the age of majority', 'A secondary document is needed once you have reached the age of majority.', 'If you have reached the age of majority in your province or territory of residence', SIN_APPLY),
  whoMayAsk: f(['employers'], 'Employers need your SIN to report your income for tax and social benefits.', 'Employers need your SIN to report your income for tax and social benefits.', SIN_PROTECT),
  financialInstitutions: f('financial institutions report interest and dividends', 'Financial institutions need your SIN to report income like interest and dividends for tax purposes.', 'Financial institutions need your SIN to report income like interest and dividends for tax purposes', SIN_PROTECT),
  governmentServices: f('government services', 'The government uses your SIN to process tax returns, check eligibility, and give access to benefits.', 'The government uses your SIN to process tax returns, verify eligibility, and provide access to benefits', SIN_PROTECT),
  onlyWhenRequired: f('give it only when the law requires it', 'Only give your SIN when the law requires it.', 'Only provide your SIN when the law requires it.', SIN_PROTECT),
  notIdentification: f('not an identity document', 'Your SIN letter or SIN card is not an identity document.', 'Your confirmation of SIN letter or SIN card are not identity documents.', SIN_PROTECT),
  whyProtect: f('protects against fraud and identity theft', 'Protecting your SIN protects you from fraud and identity theft.', 'It is important to protect your SIN to protect yourself against fraud and identity theft.', SIN_PROTECT),
  illegalToUse: f('private; illegal for anyone else to use', 'Your SIN is private, and it is illegal for anyone else to use it.', 'Your SIN is private and it is illegal for anyone else to use it.', 'https://www.canada.ca/en/employment-social-development/services/sin.html'),
};

// 7. HISTORY
export const HISTORY = {
  incomeTax1917: f({ year: 1917, act: 'Income War Tax Act' }, 'Canada\'s federal income tax began in 1917 under the Income War Tax Act.', 'it was called the Income War Tax Act when it received Royal Assent in 1917', `${CRA}/corporate/about-canada-revenue-agency-cra/ministerial-transition-2019/booktwo.html`),
  originallyTemporary: f('introduced as a temporary measure to pay for the First World War', 'It began as a temporary measure to pay for the First World War.', 'personal income tax was originally introduced as a temporary measure to finance the war', `${CRA}/corporate/about-canada-revenue-agency-cra/ministerial-transition-2019/booktwo.html`),
  gstRatesFrom: f('1991-01-01', 'The CRA\'s list of GST/HST rates by period starts on January 1, 1991.', 'GST/HST rates by jurisdiction Beginning January 1, 1991', `${CRA}/programs/about-canada-revenue-agency-cra/income-statistics-gst-hst-statistics/gst-hst-statistics/gst-hst-statistics-tables-2020-2024-calendar-years.html`),
};

// 8. SPENDING: Annual Financial Report of the Government of Canada, fiscal year 2025-2026 (April 1, 2025 to March 31, 2026).
// Amounts are $ millions. The report gives amounts, not "cents of each tax dollar" (see MISSING).
export const SPENDING = {
  year: '2025-26',
  totalRevenues: f(526412, 'The federal government took in about $526.4 billion in 2025-26.', 'Total revenues 526,412 510,951', AFR, '2025-26'),
  personalIncomeTax: f(247735, 'Personal income tax, about $247.7 billion, was the largest source of federal revenue in 2025-26.', 'personal income tax revenues at $247.7 billion are the largest source of federal revenues', AFR, '2025-26'),
  gstRevenue: f(51810, 'The GST brought in about $51.8 billion in 2025-26.', 'Goods and Services Tax 51,810 52,503', AFR, '2025-26'),
  totalExpenses: f(565728, 'The federal government spent about $565.7 billion in 2025-26.', 'Total expenses 565,728 547,299', AFR, '2025-26'),
  oldAgeSecurity: f(82741, 'Old Age Security payments were about $82.7 billion in 2025-26.', 'Old Age Security program 82,741 80,294', AFR, '2025-26'),
  employmentInsurance: f(28830, 'Employment Insurance and support measures cost about $28.8 billion in 2025-26.', 'Employment Insurance and support measures 28,830 24,880', AFR, '2025-26'),
  childrensBenefits: f(30100, 'Children\'s benefits cost about $30.1 billion in 2025-26.', 'Children\'s benefits 30,100 28,574', AFR, '2025-26'),
  healthAndSocialTransfers: f(72078, 'Federal transfer support for health and other social programs was about $72.1 billion in 2025-26.', 'Federal transfer support for health and other social programs 72,078 68,979', AFR, '2025-26'),
  fiscalArrangements: f(38763, 'Fiscal arrangements and other transfers to other levels of government were about $38.8 billion in 2025-26.', 'Fiscal arrangements and other transfers 38,763 36,122', AFR, '2025-26'),
  otherTransferPayments: f(110686, 'Other transfer payments were about $110.7 billion in 2025-26.', 'Other transfer payments 110,686 104,971', AFR, '2025-26'),
  otherDirectExpenses: f(131041, 'Other direct program expenses were about $131.0 billion in 2025-26.', 'Other direct program expenses 131,041 130,454', AFR, '2025-26'),
  publicDebtCharges: f(53541, 'Interest on the public debt cost about $53.5 billion in 2025-26.', 'Public debt charges 53,541 53,410', AFR, '2025-26'),
};

// 9. RIGHTS: CRA Taxpayer Bill of Rights (16 rights), and a taxpayer's responsibilities as the CRA "Purpose of taxes" lesson lists them
// (the Taxpayer Bill of Rights page itself has no list of responsibilities).
export const RIGHTS = {
  count: f(16, 'The Taxpayer Bill of Rights lists 16 rights that describe how the CRA must treat you.', 'There are 16 rights that describe the treatment you are entitled to when you deal with the Canada Revenue Agency (CRA).', TBOR),
  list: [
    f('receive entitlements and pay no more and no less than required by law', 'Right 1: you get the benefits and refunds you are owed and pay no more and no less than the law requires.', 'You have the right to receive entitlements and to pay no more and no less than what is required by law', TBOR),
    f('service in both official languages', 'Right 2: you can deal with the CRA in English or French.', 'You have the right to service in both official languages', TBOR),
    f('privacy and confidentiality', 'Right 3: the CRA must keep your personal and financial information private.', 'You have the right to privacy and confidentiality', TBOR),
    f('a formal review and a subsequent appeal', 'Right 4: if you disagree with a decision you can ask for a formal review and then appeal.', 'You have the right to a formal review and a subsequent appeal', TBOR),
    f('be treated professionally, courteously, and fairly', 'Right 5: the CRA must treat you professionally, politely, and fairly.', 'You have the right to be treated professionally, courteously, and fairly', TBOR),
    f('complete, accurate, clear, and timely information', 'Right 6: the CRA must give you complete, accurate, clear, and timely information.', 'You have the right to complete, accurate, clear, and timely information', TBOR),
    f('not to pay income tax amounts in dispute before an impartial review', 'Right 7: unless the law says otherwise, you do not have to pay disputed income tax until it has been reviewed fairly.', 'You have the right unless otherwise provided by law, not to pay income tax amounts in dispute before you have had an impartial review', TBOR),
    f('have the law applied consistently', 'Right 8: the CRA must apply the law the same way for everyone.', 'You have the right to have the law applied consistently', TBOR),
    f('lodge a service complaint and be given an explanation of the findings', 'Right 9: you can complain about the CRA\'s service and get an explanation of what it found.', 'You have the right to lodge a service complaint and to be provided with an explanation of our findings', TBOR),
    f('have the costs of compliance taken into account', 'Right 10: the CRA must consider what it costs you to follow the tax rules.', 'You have the right to have the costs of compliance taken into account when administering tax legislation', TBOR),
    f('expect the CRA to be accountable', 'Right 11: the CRA must be accountable for what it does.', 'You have the right to expect us to be accountable', TBOR),
    f('relief from penalties and interest because of extraordinary circumstances', 'Right 12: you can ask for relief from penalties and interest if extraordinary circumstances stopped you from meeting a tax rule.', 'You have the right to relief from penalties and interest under tax legislation because of extraordinary circumstances', TBOR),
    f('expect the CRA to publish service standards and report annually', 'Right 13: the CRA must publish its service standards and report on them every year.', 'You have the right to expect us to publish our service standards and report annually', TBOR),
    f('be warned about questionable tax schemes in a timely manner', 'Right 14: the CRA should warn you about questionable tax schemes in good time.', 'You have the right to expect us to warn you about questionable tax schemes in a timely manner', TBOR),
    f('be represented by a person of your choice', 'Right 15: you can have someone of your choice represent you.', 'You have the right to be represented by a person of your choice', TBOR),
    f('lodge a service complaint and request a formal review without fear of reprisal', 'Right 16: you can complain or ask for a formal review without fear of being punished for it.', 'You have the right to lodge a service complaint and request a formal review without fear of reprisal', TBOR),
  ],
  lateBalance: f('compound daily interest from May 1', 'If you do not pay by the due date, the CRA charges compound daily interest starting May 1.', 'If you do not pay your balance by the payment due date, the CRA will start charging you compound daily interest as of May 1.', PURPOSE),
  responsibilities: [
    f('Doing your taxes by the deadline', 'Do your taxes by the deadline, which is generally April 30.', 'Doing your taxes by the deadline Generally, you have to do your taxes by April 30.', PURPOSE),
    f('Giving accurate and complete information', 'You must give the CRA the information it needs to process your tax return correctly.', 'You must give the Canada Revenue Agency (CRA) the necessary information to process your tax return correctly.', PURPOSE),
    f('Paying your balance owing', 'Any balance owing is also due on April 30.', 'Paying your balance owing If you have a balance owing when you do your taxes, it is also due on April 30.', PURPOSE),
    f('Correcting your taxes', 'If you make a mistake or leave something out, you can correct your return.', 'If you make a mistake on your tax return or leave out details about your income, you have the chance to correct the situation.', PURPOSE),
    f('Updating your personal information', 'Tell the CRA when your personal information changes, such as your address.', 'If there is a change to your personal information, like your address or marital status, you should update it with the CRA.', PURPOSE),
  ],
};

// 10. SLIPS: box numbers. T4 and T4A boxes from the CRA pages that explain the slips to the person who receives them; T5 from the CRA T5 slip page.
export const SLIPS = {
  T4: {
    box14: f({ box: 14, name: 'Employment income', line: 10100 }, 'T4 box 14 is your employment income; you enter it on line 10100.', 'Box 14 - Employment income - line 10100', T4_SLIP, 2025),
    box16: f({ box: 16, name: "Employee's CPP/QPP contributions" }, 'T4 box 16 is the CPP you paid from your pay (box 17 is the Quebec version).', "Box 16/Box 17 - Employee's CPP/QPP contributions - line 30800 and line 22215", T4_SLIP, 2025),
    box16A: f({ box: '16A', name: "Employees' second CPP/QPP contributions" }, 'T4 box 16A is the second, additional CPP contribution (CPP2).', 'Boxes 16A and 17A – Employees’ second CPP/QPP contributions', T4_SLIP, 2025),
    box18: f({ box: 18, name: "Employee's EI premiums", line: 31200 }, 'T4 box 18 is the EI premiums taken from your pay.', "Box 18 - Employee's EI premiums - line 31200", T4_SLIP, 2025),
    box22: f({ box: 22, name: 'Income tax deducted', line: 43700 }, 'T4 box 22 is the income tax your employer already took from your pay.', 'Box 22 - Income tax deducted - line 43700', T4_SLIP, 2025),
    box24: f({ box: 24, name: 'EI insurable earnings' }, 'T4 box 24 is the amount of pay your employer used to work out your EI premiums.', 'Box 24 - EI insurable earnings', T4_SLIP, 2025),
    box26: f({ box: 26, name: 'CPP/QPP pensionable earnings' }, 'T4 box 26 is the amount of pay your employer used to work out your CPP contributions.', 'Box 26 - CPP/QPP pensionable earnings', T4_SLIP, 2025),
  },
  T5: {
    box13: f({ box: 13, name: 'Interest from Canadian sources' }, 'T5 box 13 is interest from Canadian sources.', 'Box 13 – Interest from Canadian sources', T5_SLIP, 2025),
  },
  T4A: {
    box028: f({ box: '028', name: 'Other income' }, 'T4A box 028 is other income not reported anywhere else on the T4A.', '028 Other income Amounts not reported anywhere else on the T4A slip.', T4A_SLIP, 2025),
    box105: f({ box: 105, name: "Scholarships, fellowships, bursaries, and artists' project grants", line: 13010 }, 'T4A box 105 is scholarships, fellowships, bursaries, and artists\' project grants, and it goes on line 13010.', "105 Scholarships, fellowships, bursaries, and artists' project grants Enter this amount at line 13010 of your return.", T4A_SLIP, 2025),
  },
};

// 11. T1: line numbers and names on the 2025 return (filed in 2026), from the CRA Federal Income Tax and Benefit Guide for 2025.
export const T1_LINES = {
  line10100: f({ line: 10100, name: 'Employment income' }, 'Line 10100 is where you report your employment income.', 'Line 10100 – Employment income', GUIDE, 2025),
  line12100: f({ line: 12100, name: 'Interest and other investment income' }, 'Line 12100 is where you report interest and other investment income.', 'Line 12100 – Interest and other investment income', GUIDE, 2025),
  line15000: f({ line: 15000, name: 'Total income' }, 'A CRA guide refers to your total income on line 15000 of the return.', 'when you calculate your total income on line 15000 of your return', `${CRA}/services/forms-publications/tax-packages-years/general-income-tax-benefit-package/non-residents/5013-g/guide-non-residents-deemed-residents-canada-identification-other-information-total-income.html`, 2025),
  line20800: f({ line: 20800, name: 'RRSP deduction' }, 'Line 20800 is the RRSP deduction.', 'Line 20800 – RRSP deduction', GUIDE, 2025),
  line22215: f({ line: 22215, name: 'Deduction for CPP or QPP enhanced contributions on employment income' }, 'Line 22215 is the deduction for CPP or QPP enhanced contributions on employment income.', 'Line 22215 – Deduction for CPP or QPP enhanced contributions on employment income', GUIDE, 2025),
  line23600: f({ line: 23600, name: 'Net income' }, 'Line 23600 is your net income.', 'Line 23600 – Net income', GUIDE, 2025),
  line26000: f({ line: 26000, name: 'Taxable income' }, 'Line 26000 is taxable income.', 'Line 26000 – Taxable income', GUIDE, 2025),
  line30000: f({ line: 30000, name: 'Basic personal amount' }, 'Line 30000 is the basic personal amount.', '30000 Basic personal amount', `${T1}/deductions-credits-expenses/deductions-credits-expenses.html`, 2025),
  line30800: f({ line: 30800, name: 'Base CPP or QPP contributions through employment income' }, 'Line 30800 is base CPP or QPP contributions through employment income.', 'Line 30800 – Base CPP or QPP contributions through employment income', GUIDE, 2025),
  line31200: f({ line: 31200, name: 'Employment insurance premiums through employment' }, 'Line 31200 is employment insurance premiums through employment.', 'Line 31200 – Employment insurance premiums through employment', GUIDE, 2025),
  line31260: f({ line: 31260, name: 'Canada employment amount' }, 'Line 31260 is the Canada employment amount.', 'Line 31260 – Canada employment amount', GUIDE, 2025),
  line42000: f({ line: 42000, name: 'Net federal tax' }, 'Line 42000 is your net federal tax.', 'Line 42000 – Net federal tax', GUIDE, 2025),
  line43700: f({ line: 43700, name: 'Total income tax deducted' }, 'Line 43700 is the total income tax deducted.', 'Line 43700 – Total income tax deducted', GUIDE, 2025),
  line48400: f({ line: 48400, name: 'Refund' }, 'Line 48400 is your refund.', 'Line 48400 – Refund', GUIDE, 2025),
  line48500: f({ line: 48500, name: 'Balance owing' }, 'Line 48500 is your balance owing.', 'Line 48500 – Balance owing', GUIDE, 2025),
  documents: f('information slips, receipts and supporting documents', 'Gather your information slips, such as T4s, plus receipts and other documents for anything you claim.', 'Start by gathering your documents to report income and claim deductions', GET_READY),
  slipsShow: f('slips show income paid and deductions withheld', 'Your slips show the income you were paid and the tax and other amounts taken off.', 'These slips show the amount of income that was paid to you during the year and the deductions that were withheld from that income.', `${CRA}/services/tax/individuals/segments/students/what-you-include-your-return-what-records-you-keep.html`),
  paperSlips: f('include one copy of each slip with a paper return', 'If you file on paper, you include one copy of each information slip.', 'If you are filing a paper return, include one copy of each of your information slips.', `${CRA}/services/tax/individuals/segments/students/what-you-include-your-return-what-records-you-keep.html`),
};

// 12. FILING
export const FILING = {
  deadlineMost: f('April 30', 'Most people must file their tax return by April 30.', 'Filing due date is April 30 for most taxpayers, June 15 for self-employed', `${CRA}/services/tax/individuals/topics/important-dates-individuals.html`),
  deadline2025Return: f('2026-04-30', 'The deadline to file the 2025 return was April 30, 2026.', 'April 30, 2026 : Deadline to file your taxes', `${CRA}/services/tax/individuals/topics/important-dates-individuals.html`, 2025),
  deadlineSelfEmployed2025Return: f('2026-06-15', 'If you or your spouse or common-law partner is self-employed, the 2025 return was due June 15, 2026.', 'June 15, 2026 : Deadline to file your taxes if you or your spouse or common-law partner are self-employed', `${CRA}/services/tax/individuals/topics/important-dates-individuals.html`, 2025),
  paymentDeadline2025: f('2026-04-30', 'The deadline to pay tax owing for 2025 was April 30, 2026.', 'April 30, 2026 : Deadline to pay your taxes', `${CRA}/services/tax/individuals/topics/important-dates-individuals.html`, 2025),
  // Extra facts on the 2026 return (filed in 2027); the units do not use them. The CRA's own "Due dates" page still lists only the 2025 return, so the dates come from two 2026 pages.
  deadline2026Return: { ...f('2027-04-30', 'A person who arrived in Canada in 2026 must file the 2026 return by April 30, 2027.', 'If you arrived in 2026 , you must file your 2026 tax return by April 30, 2027.', 'https://www.canada.ca/en/revenue-agency/news/newsroom/tax-tips/tax-tips-2026/tax-tip-taxes-made-simple-newcomers-canada.html', 2026), inferred: true, inferredNote: 'Scoped to people who arrived in 2026. The units use the 2025-return facts above.' },
  deadlineSelfEmployed2026Return: f('2027-06-15', 'A self-employed individual must file the 2026 return by June 15, 2027.', 'Deadline for Filing Income Tax and Benefit Returns: June 15, 2027', 'https://www.canada.ca/en/services/taxes/resources-for-small-and-medium-businesses/2026-tax-deadlines-canadian-businesses-self-employed-individuals.html', 2026),
  paymentDeadline2026: f('2027-04-30', 'The deadline to pay a balance owing for 2026 is April 30, 2027.', 'Payment Deadline: April 30, 2027 , for balances owing', 'https://www.canada.ca/en/services/taxes/resources-for-small-and-medium-businesses/2026-tax-deadlines-canadian-businesses-self-employed-individuals.html', 2026),
  waysToFileOwn: f(['tax software', 'SimpleFile', 'paper tax return'], 'You can file your own return using tax software, SimpleFile, or a paper tax return.', 'You can file your own tax return using: Tax software SimpleFile A paper tax return', GET_READY),
  waysToFileHelp: f(['professional tax preparer', 'free tax clinic volunteer'], 'Or you can have someone else file for you: a professional tax preparer or a volunteer at a free tax clinic.', 'You can have someone else file your tax return , such as: A professional tax preparer A volunteer at a free tax clinic', GET_READY),
  certifiedSoftware: f('CRA-certified tax software', 'CRA-certified tax software helps you work out your tax and send your return electronically.', 'You can use tax software certified by the Canada Revenue Agency (CRA) to help calculate and file your personal income taxes electronically.', SOFTWARE),
  netfileWhat: f('electronic filing through certified software', 'NETFILE is the CRA service that carries your return from certified tax software to the CRA over the internet.', 'After completing your return in certified tax software, you can electronically send the return to the Canada Revenue Agency (CRA).', `${NETFILE.replace('/netfile.html', '.html')}`),
  efile: f('tax preparers file clients\' returns by EFILE', 'Tax preparers send their clients\' returns to the CRA with a service called EFILE.', "You can electronically file your clients' 2018, 2019, 2020, 2021, 2022, 2023, 2024 and 2025 initial personal income tax and benefit returns using EFILE", `${CRA}/services/e-services/digital-services-individuals/efile-electronic-filers.html`),
  preparerFee: f('a preparer files for a fee', 'A tax preparer, such as an accountant, prepares your return and sends it to the CRA for a fee.', 'tax preparer (such as an accountant) who will prepare your tax return and electronically send it to the Canada Revenue Agency (CRA) for a fee', 'https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax/how-file/tax-preparer.html'),
  freeClinics: f('Community Volunteer Income Tax Program', 'Free tax clinics, run by volunteers, complete returns for people with a modest income and a simple tax situation.', 'community organizations host free tax clinics where volunteers complete tax returns for people with a modest income and a simple tax situation', `${CRA}/services/tax/individuals/community-volunteer-income-tax-program.html`),
  simpleFile: f('SimpleFile, by invitation', 'SimpleFile lets some people file automatically and for free, and the CRA invites them to use it.', 'invited to use SimpleFile to automatically file your income tax and benefit return with the Canada Revenue Agency (CRA) for free', `${CRA}/news/newsroom/tax-tips/tax-tips-2025/simplefile-let-us-help-you-with-taxes.html`, 2025),
  autoFill: f('Auto-fill My Return', 'Auto-fill My Return is a feature in tax software that fills in parts of your return from information the CRA has.', 'You can use the Auto-fill My Return service in tax software to automatically fill in parts of a tax return.', 'https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax/how-file/tax-software/complete-return/auto-fill.html'),
  studentsShouldFile: f('file every year to get benefit and credit payments', 'Students, even with little income, should file every year to get the benefit and credit payments they qualify for.', 'Do your taxes every year to get the benefit and credit payments you’re eligible for.', `${CRA}/services/tax/individuals/segments/students.html`),
  scholarshipFullTime: f('generally not taxable for a full-time qualifying student', 'A scholarship or bursary for a full-time student in a post-secondary program is generally not taxable.', 'Post-secondary school scholarships, fellowships, and bursaries are generally not taxable if you received them for your enrolment in a program', `${T1}/personal-income/line-13000-other-income/line-13010-scholarships-fellowships-bursaries-artists-project-grants-awards.html`, 2025),
  scholarshipWhen: f('full-time qualifying student in the tax year, the year before, or the year after', 'The student must be a full-time qualifying student in that tax year, the year before, or the year after.', 'for which you are considered a full-time qualifying student in the tax year, in the immediately preceding tax year, or in the following tax year', `${T1}/personal-income/line-13000-other-income/line-13010-scholarships-fellowships-bursaries-artists-project-grants-awards.html`, 2025),
  scholarshipNotQualifying: f('only the part over $500 is reported', 'If you were not a qualifying student, you report only the part of your awards that is more than $500.', 'you generally report only the part of the total of all such amounts you received in the year that is more than $500', `${T1}/personal-income/line-13000-other-income/line-13010-scholarships-fellowships-bursaries-artists-project-grants-awards.html`, 2025),
};

// 13. YEAR: what can be filed with certified software (NETFILE) in December 2026
export const YEAR = {
  netfileWindow: { ...f({ from: '2026-02-23', until: '2027-01-29' }, 'NETFILE is open from February 23, 2026 until January 29, 2027.', 'The NETFILE and ReFILE services are open for transmission from Monday, February 23, 2026 at 6:00 a.m. (Eastern time), until Friday, January 29, 2027', NETFILE, 2025), inferred: true, inferredNote: 'In December 2026 this window is open.' },
  taxYearsFileable: { ...f({ latest: 2025, earliest: 2018 }, 'NETFILE can be used to file initial returns for the tax years 2018 through 2025.', 'You can electronically file your 2018, 2019, 2020, 2021, 2022, 2023, 2024 and 2025 initial personal income tax and benefit return using NETFILE', NETFILE, 2025), inferred: true, inferredNote: 'INFERRED, not stated by the page: in December 2026 the newest year you can file with NETFILE is 2025, and the 2026 return comes later.' },
  nextSeasonStarts: f('2027-02-22', 'The CRA says a new sign-in step applies for the tax season beginning February 22, 2027.', 'For the upcoming tax season, beginning February 22, 2027', `${CRA}/news/newsroom/tax-tips/tax-tips-2026/enhancing-security-online-income-tax-benefit-return-filing.html`, 2026),
};

// Facts wanted but NOT in this file, with what was tried.
export const MISSING = [
  { fact: 'CAPITAL_GAINS: the inclusion rate for 2026 stated in one official sentence', tried: 'Rechecked 2026-11-15: CRA tax tip on the proposed changes says "all capital gains realized before January 1, 2026" are at one-half (not a 2026 statement); Budget 2026 tax measures mention only a 30 percent AMT rate; no 2026 T4037. Earlier: ' + 'CRA T4037 (2025 guide), line 12700 pages and "New for 2025", CRA tax tips of January 2025, Finance deferral release, Budget 2025 annex, Federal Tax Expenditures 2026 parts 2 and 6. Official pages give 50% for 2025 and say the planned increase was cancelled, but none states "the 2026 rate is 50%".' },
  { fact: 'INHERITANCE: an official statement that Canada has no inheritance tax', tried: 'CRA "Deemed disposition of property for deceased taxpayers", "Prepare tax returns for someone who died" pages, search of canada.ca for inheritance and estate tax. They describe the deemed disposition and the final return, but none says there is no inheritance tax.' },
  { fact: 'SPENDING: "cents of each tax dollar" shares by category for 2025-26', tried: 'Annual Financial Report 2025-26 (amounts in $ millions only; no per-dollar shares). The only "Your tax dollar" page found is the 2014-15 PDF, too old to use.' },
  { fact: 'HISTORY: date the Income Tax Act replaced the Income War Tax Act (1948)', tried: 'Only a PDF and search snippets showed it; no fetched HTML page on canada.ca states it.' },
  { fact: 'SLIPS: a T5 page written for the person who receives the slip', tried: 'canada.ca T5 slips page for individuals has no box list; the T5 box 13 name comes from the CRA page for slip issuers.' },
  { fact: 'KINDS: payroll CPP/EI contributions defined on a page for the general public beyond the Purpose of taxes lesson', tried: 'CRA payroll pages (written for employers) did not define them in plain terms; the Purpose of taxes lesson is used instead.' },
  { fact: 'YEAR: a sentence saying the 2026 return cannot be filed in December 2026', tried: 'NETFILE, tax software, get-ready and security-update pages. They show NETFILE open to 2025 returns and the next season starting February 22, 2027; the conclusion about 2026 is an inference.' },
];

// Official pages that disagree: none found. (The CRA table calls Quebec's tax a PST while the Purpose of taxes lesson calls it the QST: same tax, two names, not a conflict.)
export const CONFLICTS = [];
