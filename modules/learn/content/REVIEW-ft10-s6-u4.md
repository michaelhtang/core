# Facts Mr. Tang must confirm: Making it and paying for it (`ft10-s6-u4`)

Unit 4 of FinTech Marketplace in `fintech10.json` (2 levels, for your plan rows Jan 4 and Jan 5). There is no lesson outline for section 6, so nothing here is "from your outline". The sources are your plan rows, the FIN1910, MAM3030 and FIN1015 outcomes, the road's own units ft10-s4-u2 level 1 (the class rate) and ft10-s4-u3 level 2 (tariff), and the example business in `modules/learn/companies/north-star-pins.js` (North Star Pins). **That business is made up, and you have not seen its figures yet.** Every dollar figure is imported from that file by the generator and recomputed by `test/learn-content-ft10-s6-u4.test.js`, which also fails on any `$` amount the file does not produce. Please confirm or correct each item.

## The choices that are yours (please decide first)

1. **The business form: a partnership with one equity line, Partners' Capital** (level 2 cards 2 and 6, ft10-s6-u4-l2-q9, -q10).
2. **The tariff and the rate are examples.** The class rate US$1 = C$1.40 is "a made-up rate, only an example" (level 1 card 2); it is the rate ft10-s4-u2 level 1 teaches. The tariff is "an example tariff of 10%" of the goods in Canadian dollars, "not a real rate" (level 1 card 3). Neither is a real figure. The tariff is on the goods only (C$420.00), not on the shipping.
3. **Left out on purpose:** GST and any sales tax, income tax, wages, interest (the loan is only "paid back after the market"), depreciation, any real exchange rate or tariff rate, any named trade agreement, any named country (the supplier is "in another country and sets its prices in US dollars"). A test scans for those words.
4. **The six section names** are `PLAN_SECTIONS`: this unit covers 3 Production and operations and 4 Financial plan.

## Definitions and rules in our words, for Mr. Tang to confirm

5. **Section 3 holds** "how the product is made or bought, and who does what" (level 1 card 1). Our wording of the section.
6. **Who does what** (level 1 card 1, the last table): Mei orders the pins, Devon pays the supplier, all four partners pack each pin, Tariq runs the table. The roles are the company file's; **the jobs are made up** for the example (the file only gives roles). ft10-s6-u4-l1-q10.
7. **Import, tariff, landed cost, exchange rate, cost per unit, inventory, fixed cost, variable cost, start-up money, break-even point** use the file's `GLOSSARY` wording, shortened only by adding the term. "The tariff is on the goods" and "the rate can move" are our wording.
8. **The steps from the supplier's price to the cost per unit** (level 1 cards 2 to 4): the supplier's price in US dollars, times the rate, gives Canadian dollars; plus the example tariff and shipping gives the landed cost; divided by the pins and plus the backing card and bag gives the cost per unit. The order of steps is from the file's own arithmetic.
9. **The good and the bad of buying abroad** (level 1 card 5): good, a lower price per item and more designs to choose from; bad, waiting, a rate that can move, and a tariff. This is general teaching in our words (MAM3030 1.3). It does not say North Star Pins did better or worse than buying at home, because the file has no home price.
10. **The rate-moves example** (level 1 card 5, ft10-s6-u4-l1-q8): the card and the question now say only that a dearer US dollar makes the same US$300.00 order cost more Canadian dollars. There is no second rate and no new number.
11. **Start-up money** is "the stock plus the planned fixed costs" ($600 + $150 = $750; the file checks this). **The sources** are four partners at $150 and a $150 loan "paid back after the market" (`START`). The lender, Amara's aunt, is in the file and is **not** named in the lesson. Level 2 cards 1 and 2.
12. **A liability is a debt; the partners' share is their equity** (level 2 card 2). Short versions of section 5's glossary ("a debt: something the business owes", "the owner's share"). We wrote "partners' share" for a partnership, because the glossary speaks of one owner. Please confirm the wording.
13. **Fixed costs** are the four `FIXED` lines, $150 in all: Market table, two days $60, Display board and signs $45, Posters $30, Sample pins $15 (level 2 card 3). **The variable cost is the cost per unit, $3.00** (the file's comment). Round 2 spends $20 more on promotion (`EXTRA_PROMOTION_CENTS`); it is not in this unit because the unit reads only the plan.
14. **Break-even**: fixed costs divided by what each pin leaves. Steps: $6.00 - $3.00 = $3.00; $150.00 / $3.00 = 50 pins (level 2 card 4, from `breakEven(PRICE.round1)`). **Break-even sales** of $300 (50 x $6.00, ft10-s6-u4-l2-q8) and the "check it" table at 40, 50 and 60 pins (level 2 card 5: 40 pins = $240 sales and $270 costs, $30 short; 60 pins = $360 and $330, $30 profit) are computed from the file's figures; the file does not print them. The table counts the cost of the pins sold plus the fixed costs, as the break-even step does.
15. **At $5.00 with the same $150 of fixed costs, break-even is 75 pins** (ft10-s6-u4-l2-q7, `breakEven(PRICE.round2)` with the planned fixed costs). The file's own $5.00 break-even (85 pins) adds the $20 of extra promotion; this question does not, and says "the fixed costs stayed $150.00".
16. **The opening balance sheet** (level 2 card 6) is `balanceSheet(0)`: cash $750, loan $150, Partners' Capital $600, assets = liabilities + equity as in Accounting Prep. It is titled "Balance Sheet / The day the money is collected" (the file's own phrase for moment 0), because you asked for no calendar dates. It has no Inventory line yet: the pins are bought before the first market day.

## Figures

17. **Every figure is from the company file** and recomputed in the test: US$1.50 a pin, 200 pins = US$300.00, C$420.00, tariff $42.00, shipping $38.00, landed cost $500.00, $2.50 a pin, $0.50 for the card and bag, $3.00 a pin (ft10-s6-u4-l1-q2 to -q8); $750, $600, $150, break-even 50 pins, 75 pins at $5 (ft10-s6-u4-l2).
18. **Number answers are in dollars.** The number box takes only `$`, `%` or `hours`, so counts of pins are asked as choices (ft10-s6-u4-l2-q6, -q7) and the dollar amounts as numbers.
19. **The bars figure** (level 1 card 4) shows the 300 cents of one pin's cost as four bars: the pin $2.10, the tariff $0.21, shipping $0.19, the card and bag $0.50 (each is the order's amount divided by 200, or the packaging). These per-pin parts are computed, not in the file. The $3.00 total is the file's.
20. **Tables** have at most 4 columns.

## Written without a number, or left out on purpose

21. **A real exchange rate, a real tariff rate, a real supplier or country:** none. The class rate is the road's own example.
22. **The game.** No `go` button. The game has no foreign money or trade, and FinTech 10 students can shop, work and invest in Venture Row but cannot found a company there (`modules/ventures/constants.js`), so no `go` button is used.
23. **Outcomes** by level: level 1 MAM3030 1.1, 1.3, 2.5.1, 2.8.3, 3.4.2; FIN1910 2.1.6. Level 2 FIN1910 2.1.6, 4.1.3; FIN1015 1.4. MAM3030 2.5.1 is touched only through the example tariff, and 2.8.3 only through the class exchange rate and one example of the rate moving. The teaching says nothing about devaluation or revaluation.
24. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s6-u4-prompts.tsv` (a banner and one line for each of the 2 cards that has no table or chart).
25. **Where the starting plan changed:** nothing in the layout. The cost-per-unit parts are shown as bars (level 1 card 4) instead of a table, so the student compares sizes. Level 2 has the break-even "check it" table as its own card.

## Added after the independent check (2026-11-11)

26. Level 1 question 8 was a number question built on a made-up second exchange rate (US$1 = C$1.50). The checker pointed out that the rate is not in the example business's file and that the card gave the answer away. It is now a choice question: what happens to the Canadian-dollar cost when one US dollar costs more Canadian dollars.
27. After the six units were put together (2026-11-11): the opening balance sheet (level 2 card 6 and the questions that show it) gained a "Total liabilities" row, so it has the same rows as the balance sheets in unit 6.
