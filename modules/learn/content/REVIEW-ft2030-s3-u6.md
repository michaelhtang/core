# Facts Mr. Tang must confirm: Growth, inflation and real return (`ft2030-s3-u6`)

Unit 6 of The Investor in `fintech2030.json`, written from four day outlines in `slide-studio/courses/fintech2030/context/outlines/`: `2026-10-21 Lesson 26 (v3).md` (the Rule of 72, exact against the rule, growth with deposits), `2026-10-28 Lesson 31.md` (inflation grows your bills, the inflation target), `2026-11-05 Lesson 37.md` (inflation and real return) and `2026-11-06 Lesson 38.md` (percent change, a short stretch is a sample). Line numbers below are in those files. The growth figures are recomputed by `test/learn-content-ft2030-s3-u6.test.js` (month by month and year by year), and the game's starting rates come from `modules/rates/constants.js`. Please confirm or correct each item.

## Where this unit departs from your outlines (read these first)

- **Lesson 26's huddle claim (line 161) is not taught** (item 14): the outline says adding $1,000 a year to $10,000 shortens the doubling time "less than expected". My recomputation says it about halves it at 6%.
- **Two Lesson 31 figures differ by a cent** from your Price Grower check values: $5,766.69 (yours $5,766.70) and $7,957.01 (yours $7,957.00) (item 9).
- **Past-crash returns and index levels from Lesson 37 are not used**: your outline flags them VERIFY (items 18 to 20).
- **Fees are not taught here.** Lesson 26's fee part is already in `ft2030-s3-u4` (Funds and fees).
- **Outcome codes**: `FIN3080 2.1.7`, `FIN3090 3.2`, `FIN3090 3.4`. 2.1.7 is written for one stock; the unit teaches the rule on money in general (your own table, Lesson 26 line 49, says the outcome is written for one stock).

## Your choices

1. **Days covered.** Level 1 is Lesson 26 slides 3 to 7 (the rule, where it is rough, the monthly example). Level 2 is Lesson 26 slide 7 and its huddle (`=FV` and a yearly contribution), taught as the idea of regular deposits. Level 3 is Lesson 31 slides 3 and 4 (a monthly cost grown to a later age, the inflation target) with the "same year's dollars" point from Lesson 31's last misconception note. Level 4 is Lesson 37 slides 4 and 5 (real return). Level 5 is Lesson 38 slides 3 and 4 (percent change, a sample), plus two cards of mine: a new price from a percent, and a total against a yearly change.
2. **Left out.** The fee part of Lesson 26 (taught in `ft2030-s3-u4`); the Doubling Machine, Return Check and Real Doubling workbooks and the Life Cycle project (not described); the sourced inputs (a planning-rate guideline, the latest CPI, a bank's GIC rate, the Bank of Canada calculator's 1976 result: see "written without a number"); the Lesson 37 grandfather story and Parts 3 and 4 (history); the FinTech 30 add-ons (after-tax real return); Lesson 38's ISP reflection, equipment list and kitchen form. "50 years of prices" is not used even as an idea, since no card needed it.
3. **Level plan.** Five levels: the rule and where it is rough; regular deposits; inflation grows your costs; real return; percent change and short stretches. Level 5 was split from level 4 after a check found level 4 held two topics.
4. **No game number is a fact.** The Bank of DAA's savings rate and inflation rate are defaults the teacher can change. Level 4 card 3 says "the game starts at 2.75% and 2.1%, and the teacher can change them" and sends the student to the building (`go` button, "See the live rates"). 2.75% is the starting policy rate 2.25% plus the 50-point savings spread, and 2.1% is the starting inflation, both in `modules/rates/constants.js`; the test recomputes them. No question uses them. A FinTech 20/30 student can open the Bank of DAA (module `rates` is on for `fintech2030`); it lists the savings (HISA) rate and says how fast prices rise.
5. **Names.** Sol, Tia, Sam, Mel, Lee, Pat, Rin, Ana, Dee, Cy, Mia, Kai, Noor, Rae, Ines and Oren are made up; no student is named. No bank, fund, index, company or app is named.

## Figures from your outlines (recomputed; used as the class example)

6. **$10,000 at 6% for 12 years, paid monthly: $20,508; exact doubling 11.6 years.** Lesson 26 lines 33 and 142 ($20,508; 11.58). Ours: 0.5% a month for 144 months is $20,507.51, shown as $20,508; doubling 11.58 years, shown as 11.6. Level 1 card 5. The card says "added monthly" where your slide says "every 30 days".
7. **Exact doubling times: 1% 69.7, 3% 23.4, 6% 11.9, 9% 8.0, 12% 6.1, 24% 3.2 years.** Lesson 26 line 197 (6% 11.90, 1% 69.66, 24% 3.22) and line 189 (3% 23.45, 9% 8.04, 12% 6.12). All match. The table shows one decimal where yours show two; 3% shows 23.4 because the unrounded figure is 23.4498 (your 23.45 is that figure to two decimals). Level 1 card 3, card 4, l1-q4.
8. **The rule is "close in the middle and rough at the edges".** Lesson 26 lines 115 and 124 (slide 4's note, "close between about 4% and 12%"; slide 5's note: 1% rule 72, exact about 69.7; 24% rule 3, exact about 3.2). The card says the rule is within about 0.1 of a year at 6%, 9% and 12% (gaps 0.1, 0.0 and 0.12) and does not claim a range from 4%. Level 1 card 4, l1-q7.
9. **$3,000 of bills at 2% for 33 years: $5,766.69, times 1.92. Differs from your $5,766.70.** Lesson 31 lines 124, 258, 259, 293. $3,000 x 1.02^33 = $5,766.694, so the cent figure is $5,766.69 (your slide 3 rounds to $5,767). The 1% figure matches ($4,166.07). The 3% figure is $7,957.01 here against your $7,957.00 ($7,957.0057). Level 3 cards 2, 3 and 5. The "add 2% thirty-three times" slip ($4,980.00) is mine; your notes (line 126) say students add 2% x 33 once and land near $3,600 to $4,000, which I did not use.
10. **The Bank of Canada's inflation target: 2%, the midpoint of a range from 1% to 3%.** Lesson 31 line 50 (flagged in your list of things to check on the Bank's page that day). The card says only that it aims to keep inflation near 2% and that this is its target; the agreement and its renewal are left out. `ft10-s2-u3` level 1 says the same thing. Level 3 card 4, l3-q9. Please confirm the wording against the Bank's page.
11. **$200,000 in a GIC at 3%, 3% inflation, 10 years: $268,783 on the statement, buys $200,000.** Lesson 37 lines 164, 171 and 323 ($268,783.28). Level 4 card 1. Used with "a class example" and without the grandfather story.
12. **At 2% inflation the statement buys $220,496 (real return 1.0%); at 5% it buys $165,010 (-1.9%).** Lesson 37 lines 325 and 327; they match. Level 4 card 2 and its table. The real return formula (1 + rate) / (1 + inflation) - 1 is your line 165 and 296.
13. **A 6% fund with 2% inflation: buying power doubles in about 18 years, not 12.** Lesson 26 line 161 (Real Doubling huddle) and line 181 (the closing vote). Level 4 card 4, l4-q5. The exact real return is 3.9% (1.06 / 1.02 - 1), so about 18.4 years; the card says "about 4%" and "about 18", as the outline does.
14. **Growth with a yearly contribution (Lesson 26 line 161): not taught as written.** Your note says "Add $1,000 a year to the $10,000. Does doubling time halve? ... the answer is no, it shortens less than they expect." At 6% with $1,000 added at the end of each year, $10,000 reaches $20,000 in about 5.5 years against 11.9 without deposits, which is 46% of the time, so it about halves. I did not teach either claim. Level 2 teaches that deposits make the balance reach a target sooner and that the Rule of 72 describes only a lump (card 4, l2-q8: with $100 a month the balance passes $20,000 in 58 months, under the rule's 12 years). Please check which you meant.
15. **Percent change = (latest - start) / start x 100.** Lesson 38 lines 167 to 170 and 406. The prices in the cards and questions are my own made-up ones ($50.00 to $56.00; a price at weeks 0, 2, 4 and 6; $80.00 to $92.00; $40.00 to $32.00). Your example numbers ($40.00 to $43.00, $25.00 to $20.00, the Week 3 and Week 6 figures) are not used. Level 5 cards 1 to 4, l5-q2 to l5-q5. The 15%, 20%, $230.00 and $99.00 answers are mine.
16. **"A short stretch is a sample, not a verdict."** Lesson 38 lines 2, 184 to 187 and 407. The weekly table is mine. Level 5 card 4, l5-q7. The table's change column is measured from the $50.00 start each time. No real stock or result is described.

## Growth with deposits (level 2): all mine

17. **Convention.** The monthly rate is the yearly rate divided by 12 and each deposit goes in at the end of a month, as in `ft2030-s3-u1`. Level 2 card 1. Every balance is shown to the nearest dollar (the first three months to the cent). The shortcut formula, balance = deposit x (1.005^n - 1) / 0.005, is my wording for the sum of the monthly chain; your outline only names the spreadsheet function. Level 2 card 3, l2-q6. Card 2 says "a spreadsheet's future value function" does this and names no cell or formula. The tables ($100 a month over 10, 20, 30 and 40 years; the lump and the deposits; $100 and $125 a month at 6% and $100 at 8% over 20 years) and the 30-year bars in l2-q7 are mine, at example rates.

## Written without a number (your outline flags it, or it needs a live source)

18. **Past crash returns** (Lesson 37 lines 55, 201 and 354 to 368: 2008, 2020 and 2022 for stocks, bonds and a GIC, and the 60/40 mix, marked VERIFY): flagged "from memory and unverified"; not used.
19. **Index levels and the 50-year history** (Lesson 37 lines 57 and 354 to 355, index levels): no number or event is used.
20. **Sourced inputs of the day**: the latest CPI change, one bank's 5-year GIC rate, the Bank of Canada calculator's value for $100 from 1976, and the planning-rate guideline of Lesson 26. None is used; the unit works only with example rates.
21. **RRSP and TFSA limits** (Lesson 31 line 49): flagged unverified; not used.

## Definitions and rules in our words, for Mr. Tang to confirm

22. **The Rule of 72** (years to double is about 72 divided by the yearly rate, and rate is about 72 divided by the years), "for one lump of money with nothing added or taken out". Level 1 card 1. Level 2 card 4 says the rule describes only the lump.
23. **Exact doubling time** is found by multiplying year by year (or with a calculator or spreadsheet). Level 1 cards 2 and 3.
24. **Monthly compounding**: a monthly rate of yearly rate / 12 applied to the balance each month. Level 1 card 5, level 2 card 1.
25. **Inflation** (a rise in prices over time, so the same dollars buy less) and growing a bill: multiply by 1 plus the rate for each year. Level 3 card 1. The "same year's dollars" rule is from your Lesson 31 note on the Stage C check; wording ours. Level 3 card 5.
26. **Nominal and real**: nominal is what the statement shows, real is what the money buys after prices rise. Level 4 card 1. **Real return** = (1 + rate) / (1 + inflation) - 1, with the shortcut rate minus inflation and where it drifts (8% and 5%: 3.0% against 2.9%). Level 4 cards 2 and 3.
   Level 5 adds: a new price from a percent (up 10% then down 10% does not return to the start) and "a percent change covers the whole stretch, not a yearly rate" (cards 2 and 3, my wording).
27. **Buying power doubling** by running the Rule of 72 on the real return. Level 4 card 4.
28. **Percent change** and **sample**, defined as above. Level 5 cards 1 and 4.

## Where this unit meets the ones around it

29. `ft2030-s3-u1` (cost of waiting, monthly compounding at 7% / 12, end-of-month deposits): same convention, different numbers. `ft2030-s3-u4` level 4 has one card on the Rule of 72 for fees (a 6% fund less a 2% fee, 18 years against 12): this unit does not repeat the fee case; level 4 card 4 uses the same 6% and 2% for inflation, which is your own Lesson 26 pairing. `ft10-s2-u2` and `ft10-s2-u3` already teach the rule, compound growth and inflation; this unit goes on to the exact time against the rule, regular deposits, and real return. Both ask students to treat 3% and 2% as examples.
