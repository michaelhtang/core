# Facts Mr. Tang must confirm: Sales round one (`ft10-s6-u5`)

Unit 5 of FinTech Marketplace in `fintech10.json`, 2 levels. There is no lesson outline for section 6, so nothing here is "from your outline". The sources are your plan rows for Jan 6 (level 1) and Jan 7 (level 2), the outcomes FIN1910 2.1.1, 3.1, 3.2, 4.1.3 and FIN1015 1.3, and the example business North Star Pins in `modules/learn/companies/north-star-pins.js`. You have not seen that business's figures yet, so please read them first. Every dollar figure and count is imported from that file, not typed, and `test/learn-content-ft10-s6-u5.test.js` recomputes each one from the file's inputs.

## Your choices, at the top

1. **The business form.** North Star Pins is a partnership of four students with one equity line, Partners' Capital. (Used in unit 6; this unit does not show a balance sheet other than through inventory.)
2. **The tariff and the exchange rate are examples.** US$1 = C$1.40 and a 10% tariff are the road's example figures. This unit does not quote either; they sit inside the $3.00 cost per unit.
3. **GST, any sales tax, income tax, wages and interest are left out.** The partners are not paid, and the test fails if those words appear.
4. **The names of the six plan sections** are the file's `PLAN_SECTIONS`. This unit uses section 4 "Financial plan" and section 5 "Forecast" (level 2 card 4, ft10-s6-u5-l2-q9).
5. **The lessons only read the results.** Level 1 says "the first market day" and "your class will read its own business's numbers the same way" (card 1). Nothing says how a round is run, decided or simulated.

## Definitions and rules in our words, for Mr. Tang to confirm

6. **Sales = pins sold times the price** (level 1 card 1, ft10-s6-u5-l1-q2, -q3). Our wording; "sales" is not in the file's glossary.
7. **Forecast.** The glossary's sentence, "a careful estimate of future sales and costs, made before they happen", is used word for word (level 1 card 2, level 2 card 4, ft10-s6-u5-l2-q10).
8. **Cost per unit** ($3.00) is named, not rebuilt; the lesson says only what the glossary says ("what one item costs to get ready to sell", shortened to "cost ... to get ready to sell"). **Cost of goods sold** uses the glossary wording and adds "it is the cost per unit times the pins sold, not the price" (level 1 card 3, ft10-s6-u5-l1-q5).
9. **Inventory** uses the glossary wording and adds "counted at cost" (level 1 card 4, ft10-s6-u5-l1-q7, -q10). Your section 5 level (`ft10-s5-u4-l2`) defines it the same way.
10. **The break-even point** is the glossary's sentence. The lesson adds: each pin leaves price minus cost per unit, and break-even = fixed costs / what each pin leaves (level 1 card 5, ft10-s6-u5-l1-q8, -q9). The $150 of fixed costs is for the whole plan (both market days); the first day paid $120 of it. The card compares the first day's pins with 50 and says the day "sold 20 more than that". Please confirm that is how you want a single day read against a whole-plan break-even.
11. **Other expenses** = "the costs of running the day that are not the pins themselves" (level 2 card 2, ft10-s6-u5-l2-q5). Our wording. The glossary has only gross profit and net income.
12. **The income statement's order**: sales, cost of goods sold, gross profit, the other expenses, net income (level 2 cards 1 and 3, ft10-s6-u5-l2-q1). It follows section 5's Pedal Parts statement (`ft10-s5-u4-l2`), with the four expense lines listed one by one and a "Total other expenses" row. The title line is "Income Statement / For the first market day" as the brief asks. The forecast statement's title, "Income Statement / Forecast for the first market day", and the small table title "Other expenses / First market day" are our titles.
13. **The forecast statement** (level 2 card 4) uses the same method as the real one: forecast pins x price, forecast pins x cost per unit, and "the same $120 of other expenses". The file gives no separate forecast expenses, so the first day's actual expenses are used as the plan's. The forecast of 60 pins is "their own estimate" in the file; the lesson says only that the partners forecast 60 pins and does not say how they got it.
14. **Comparison card** (level 2 card 5): the "Difference" column is actual minus forecast. The lesson says nothing beyond "ten more pins sold and nothing else moved" (card 6); the sentence is true of this example because the expenses are the same by construction.
15. **"Your group will do the same for its own business"** (level 2 card 4): the plan row says "own Sec 5 forecast using the same method"; the card does not describe the group's business.

## Figures and how each was computed

16. **Pins sold** 45 Aurora and 25 Bison = 70 (`ROUNDS[0].pins`). **Sales** 70 x $6 = $420. **Cost of goods sold** 70 x $3 = $210. **Gross profit** $210. **Other expenses** $30 + $45 + $30 + $15 = $120. **Net income** $90. All equal `round(1)`.
17. **Forecast**: 60 pins; sales $360; cost of goods sold $180; gross profit $180; net income $60. Computed from `FORECAST.round1Pins`, `PRICE.round1`, `unitCostCents` and the round's expenses; the file does not state them. Difference: 10 pins, $60 of sales, $30 of cost of goods sold, $30 of gross profit, $30 of net income.
18. **Pins left** 200 - 70 = 130 (`balanceSheet(1).pinsLeft`); **inventory** 130 x $3 = $390 (`balanceSheet(1).inventory`). Sold $210 + left $390 = $600, the cost of the 200 pins (`inventoryCostCents`).
19. **Break-even**: `breakEven(PRICE.round1)` = 50 pins = $150 / $3. **Sales at the break-even point** $300 = 50 x $6; **sales at the forecast** $360 = 60 x $6. These two bars (level 1 card 5 and ft10-s6-u5-l1-q9) are computed here, not in the file. $300 covers the 50 pins' cost ($150) and the fixed costs ($150).
20. **Bars** hold cents (30000, 36000, 42000) and draw as $300.00, $360.00 and $420.00.

## Written without a number, or left out on purpose

21. **How the forecast of 60 pins was reached** is not said (the file does not say). The survey is not used here.
22. **The game.** No `go` button. FinTech 10 students can open Venture Row and shop, work and invest there, but cannot found a company (`modules/ventures/constants.js`), and the companies there are not this section's example business, so no `go` button is used.
23. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s6-u5-prompts.tsv` (a banner and the 3 cards that have no table).
24. **Outcome codes**: FIN1910 3.1, 3.2 and 4.1.3 (level 1, reading the results), FIN1910 2.1.1 and FIN1015 1.3 (level 2, the plan's forecast and the income statement).
25. **Changes from the starting plan**: none of substance. Level 1 gets a bars figure (sales at break-even, forecast and first day) so the break-even point can be compared with the day; gross profit is left to level 2, where the statement defines it.

## Added after the independent check (2026-11-11)

26. Level 1 card 5 and question 8 now say the 50-pin break-even point is "for the whole plan" and that the first day "alone" sold 20 more than it. The 50 pins cover the fixed costs of both market days ($150), while the first day itself paid $120 of them, which is why its net income is $90 and not $60. Say so if you would rather teach a break-even point for one day.
27. Level 1 question 9: the line shown after a wrong answer no longer points at the right bar.
