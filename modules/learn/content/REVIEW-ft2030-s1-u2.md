# Facts Mr. Tang must confirm: The CRA and you (`ft2030-s1-u2`)

Unit 2 of The Taxpayer in `fintech2030.json`, 3 levels, outcomes FIN2060 1.2 to 1.5. **`modules/learn/companies/tax-facts.js` is a draft read from official pages on 2026-11-15 and awaits your confirmation.** The spending year used is **fiscal year 2025-26** (amounts in $ millions, from the Annual Financial Report). All facts below are keyed to that file (`tax-facts.js` key, then the page it holds). `test/learn-content-ft2030-s1-u2.test.js` recomputes every figure from it.

## Your choices, at the top

1. **Mr. Tang chose the 2025 tax year throughout (2026-11-15).** The spending year stays 2025-26, the newest Annual Financial Report (no 2026-27 report exists yet).
2. Everything real comes only from `tax-facts.js`. Wording follows each fact's `quote`, not its longer `say`, where the two differ (e.g. the SIN card names employers and financial institutions only, not banks). Spending lines use the report's own names, cut shorter but never renamed ("Federal transfer support for health and other social programs" loses only the word "other" in the table, to fit the 60-character cell limit).
3. No "cents of each tax dollar" figure (it is in MISSING). The Income Tax Act of 1948 is left out (MISSING). Shares in the unit are computed here from the file's amounts.
4. No `go` button. No SIN, account number or address is shown anywhere; the test fails on nine-digit runs.
5. Left out of scope: how the CRA is organised, audits, and the Taxpayer Bill of Rights (a later unit).

## Real facts used

5. CRA runs tax laws for the federal government and most provinces and territories: l1 card 1, l1-q1. `CRA_ROLE.administers`, https://www.canada.ca/en/revenue-agency/corporate/about-canada-revenue-agency-cra.html
6. CRA collects Alberta personal income tax with federal income tax: l1 card 2, l1-q2, l3-q4. `CRA_ROLE.alberta`, https://www.alberta.ca/taxes-levies-overview
7. Each person files their own return every year: l1 card 3, l1-q3, l3 card 2. `CRA_ROLE.selfAssessment`, https://www.canada.ca/en/revenue-agency/services/tax/individuals/educational-programs/purpose-taxes.html
8. CRA runs benefit and incentive programs through the tax system: l1 card 4, l1-q8. `CRA_ROLE.benefitPrograms`. (The 2016-17 "billions of dollars" claim was removed with `paysBenefits`.)
9. Canada Groceries and Essentials Benefit, formerly the GST/HST credit, paid every three months to eligible people: l1 card 5, l1-q4 (made-up $180.00 payment, 12 / 3 = 4 payments), l1-q5, l1-q6. `CRA_ROLE.cgeb`.
10. To continue to receive benefit and credit payments, people must update their information with the CRA each year by filing their income tax and benefit return: l1 card 6, l1-q7. `CRA_ROLE.filingKeepsBenefits` (quote from the CRA 2025-26 departmental plan; the text states no year).
11. SIN is a 9-digit identifier for working and for government programs and benefits; Service Canada issues it: l2 card 1, l2-q2. `SIN.what`, `SIN.issuer`.
12. Anyone 12 years or older can apply for their own SIN; no fee; online, by mail or in person: l2 card 2, l2-q3, l2-q4. `SIN.whoCanApply`, `SIN.fee`, `SIN.howToApply`.
13. Documents listed: birth certificate from a vital statistics agency, passport, provincial or territorial ID card or driver's licence, other Canadian government ID: l2 card 3 (table), l2-q5. `SIN.primaryDocument`, `SIN.secondaryDocument`. The unit does not say which are "primary" or "secondary" or who must show which.
14. Employers need the SIN to report income for tax and social benefits; financial institutions need it to report income like interest and dividends (the unit never says "banks"; the questions say "financial institution"): l2 card 4, l2-q1, l2-q6, l2-q7. `SIN.whoMayAsk`, `SIN.financialInstitutions`. "Only provide your SIN when the law requires it": l2 card 4, l2-q6. `SIN.onlyWhenRequired`.
15. A SIN confirmation letter and card are not identity documents: l2 card 5, l2-q8. `SIN.notIdentification`.
16. Protecting it guards against fraud and identity theft; illegal for anyone else to use: l2 card 6, l2-q9, l2-q10. `SIN.whyProtect`, `SIN.illegalToUse`.
17. Federal income tax began in 1917 under the Income War Tax Act: l3 card 1, l3-q1. `HISTORY.incomeTax1917` (year, and the act's name for l3-q3).
18. Introduced as a temporary measure to pay for "the war" (the quote does not name the First World War, so neither does the unit): l3 card 2, l3-q2. l3-q3 asks the name of the act, so nothing depends on the current year. `HISTORY.originallyTemporary`.
19. 2025-26 revenue and spending, $ millions: personal income tax, GST, total revenues (l3 card 3, l3-q5); total expenses and eight spending lines (l3 card 4, l3-q6, l3-q8, l3-q9); public debt charges (bar, l3-q7). Row and bar names follow each quote: Public debt charges, Fiscal arrangements (of "Fiscal arrangements and other transfers"), Old Age Security ("Old Age Security program"), Employment Insurance ("Employment Insurance and support measures"), Federal transfer support for health and social programs. Keys `SPENDING.personalIncomeTax`, `gstRevenue`, `totalRevenues`, `totalExpenses`, `oldAgeSecurity`, `employmentInsurance`, `childrensBenefits`, `healthAndSocialTransfers`, `fiscalArrangements`, `otherTransferPayments`, `otherDirectExpenses`, `publicDebtCharges`; page: the Annual Financial Report 2025-26 (`AFR` in the file).

## Computed in the generator (our arithmetic)

20. The eight spending lines add up to $547,780 million ($547.8 billion), less than the $565,728 million total, so the card says some spending is not listed (l3 card 4).
21. Bar shares are each line / total expenses, to one decimal: 23.2, 19.6, 14.6, 12.7 and 9.5 percent (l3 card 5, l3-q7).
22. Personal income tax as a share of total revenues is 47.06 percent, answered as 47 (l3-q5). Old Age Security of total expenses is 14.63 percent, answered as 15 (l3-q6).
23. Spending less revenue is $39,316 million, "$39.3 billion more spent than collected" (l3 card 6, l3-q10).
24. The card says personal income tax "brought in more than the GST" (l3 card 3), the only comparison the file's figures support. It does not say "biggest source".

## Definitions and rules in our words, for Mr. Tang to confirm

25. "A tax law is a rule about who pays tax and how much" (l1 card 1). "A return is the form that reports your income and works out your tax" (l1 card 3, l1-q9). "A benefit is a payment to people who qualify for it" (l1 card 4). "Identity theft is when someone uses your details to pretend to be you" (l2 card 6). "An income tax is a tax on the money people earn" (l3 card 1).
26. "Today each person still files a return every year" (l3 card 2) joins fact 7 to the 1917 history; the file does not say the 1917 tax and today's tax are one continuous law.

## Written without a number

27. How much the CRA pays out in benefits: the file states no amount. The date the Income Tax Act replaced the 1917 Act (1948) and "cents of each tax dollar" are MISSING in the file, so the unit gives neither.
