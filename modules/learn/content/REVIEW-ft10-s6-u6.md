# Facts Mr. Tang must confirm: Round two and the wrap (`ft10-s6-u6`)

Unit 6 of FinTech Marketplace in `fintech10.json`, 3 levels; its last level is the last level of the FinTech 10 road. There is no lesson outline for section 6, so nothing here is "from your outline". The sources are your plan rows for Jan 11, 12 and 13 (levels 1 to 3), the outcomes FIN1910 2.2, 3.2, 3.3, 3.4, 4.1.3, 4.1.4, FIN1015 1.3, 1.4 and MAM3030 4.3, and the example business North Star Pins in `modules/learn/companies/north-star-pins.js`. You have not seen that business's figures yet. Every figure is imported from the file and `test/learn-content-ft10-s6-u6.test.js` recomputes each one from the file's inputs.

## Your choices, at the top

1. **The business form**: a partnership of four students with one equity line, Partners' Capital (level 2 cards 1 to 4). Equity is explained as "the partners' share", adapted from section 5's "owner's equity" glossary entry.
2. **The tariff and the exchange rate are examples** (level 3 card 2). The cards use "1 cent" and "1 point" moves of the example rate and tariff; they quote no rate or tariff.
3. **GST, any sales tax, income tax, wages and interest are left out.** The loan is "repaid after the market" and nothing is said of a charge on it. The test fails on those words.
4. **The names of the six plan sections** are the file's `PLAN_SECTIONS` (level 3 card 1 shows all six).
5. **The lessons only read the results** of "the first market day" and "the second market day". Nothing says how a round is run or decided. Level 1 card 1 says only that the partners made two changes, and "your class will read its own second day the same way".

## Definitions and rules in our words, for Mr. Tang to confirm

6. **What a pin leaves = price minus cost per unit** ($3 at $6, $2 at $5) (level 1 card 2, ft10-s6-u6-l1-q2). The glossary's "markup" is not used. Our wording.
7. **The new break-even point** = fixed costs / what each pin leaves = $170 / $2 = 85 pins, "if every pin sold at $5" (level 1 card 3, ft10-s6-u6-l1-q4). It is `breakEven(PRICE.round2, fixedCents + EXTRA_PROMOTION_CENTS)`. The first day sold at $6, so 85 is a what-if for the whole plan at $5. Card 4 and ft10-s6-u6-l1-q9 then compare the second day's 110 pins with 85 ("25 more"). Please confirm that reading.
8. **"Both aim at selling more pins"** (level 1 card 1) states the purpose of the two changes. The file does not give the partners' reason, so this is our sentence; the lesson never says the changes caused the extra pins.
9. **Why gross profit rose only $10** (level 1 card 5, ft10-s6-u6-l1-q8): each pin left $1 less, so the 40 extra pins added little. The $10 is `round(2).grossProfit - round(1).grossProfit`. The sentence is arithmetic from the file's figures.
10. **Assets, liabilities, Partners' Capital** (level 2 cards 1 to 3): the glossary's wording of asset and liability is the term shown on the questions; the capital sentence "Net income links the two statements: what the business earned is added to what the partners own" is our wording. Balance sheet titles are "Balance Sheet / After the first market day", "... After the second market day" and "... Before the pins are bought" (the last is ours, for the moment the money is collected, `balanceSheet(0)`).
11. **Why net income rose more than gross profit** (level 2 card 6, ft10-s6-u6-l2-q8): the first day paid $120 of the other expenses and the second only $50, "because the first day carried most of the fixed costs". True of this example: the display board, signs and sample pins are all in the first day. Net income rose $80; gross profit rose $10; expenses fell $70.
12. **Risks** (level 3 cards 2 and 3). The five risks are the ones you asked for. The "What it could do" and **"What to do" cells are our suggestions**, not from the file: order early and ask for a date; keep some spare cash; check the tariff before ordering; order fewer and sell later; cover the backs, and a safety rule. Please confirm or correct each.
13. **Safety rule** for the sharp pin backs ("such as keeping the backs covered"): our example, serving FIN1910 2.2. No standard or law is named.
14. **Conclusions** (level 3 cards 4 and 5): "the conclusions compare the plan with what happened, then say what the partners would change next time, and they point to a number". Our wording of what a conclusion is. The card gives no recommendation about price; it only reports that gross profit rose by $10 and 20 pins were left over.
15. **The last card** (level 3 card 6): "the $150 loan is repaid, and the profit is shared equally ... $65 each." It says nothing of how the capital or the 20 leftover pins are shared out; the file does not. The road ends on the sentence "That is one business, followed from its first idea to its last number." Please confirm you want that sentence to close the road.

## Figures and how each was computed

16. **Round 2**: 60 Aurora + 50 Bison = 110 pins at $5; sales $550; cost of goods sold 110 x $3 = $330; gross profit $220; other expenses $30 market table + $20 more posters = $50; net income $170 (all `round(2)`).
17. **Break-even**: 50 pins at $6 with $150 of fixed costs; 85 pins at $5 with $170 (`breakEven`). Fixed costs $170 = `fixedCents` + `EXTRA_PROMOTION_CENTS`.
18. **Balance sheets** (`balanceSheet(0|1|2)`): at the start cash $750, loan $150, Partners' Capital $600. After the first day cash $450, inventory $390 (130 pins), total assets $840, capital $690. After the second day cash $950, inventory $60 (20 pins), total assets $1,010, capital $860. Each balances: $840 = $150 + $690; $1,010 = $150 + $860.
19. **Both days** (`total()`): 180 pins, sales $970, gross profit $430, other expenses $170, net income $260. **Profit share** `shareEachCents()` = $260 / 4 = $65.
20. **Two figures not in the file, computed from its figures**: one cent on the exchange rate moves the US$300.00 order by US$300.00 x C$0.01 = $3.00 (before the tariff); one point of tariff is 1% of the C$420.00 order = $4.20. Used in level 3 card 2 and ft10-s6-u6-l3-q4 ($4.20 x 2 = $8.40) and -q5 ($3.00 x 3 = $9.00). The "2 points" and "3 cents" are made-up moves.
21. **Level 3 card 4**: the plan's "net income, first day" of $60 is the forecast from unit 5 level 2 (60 pins). "Pins ordered, then sold" is 200 against 180.
22. **Bars** hold cents (9000, 17000, 26000) and draw as $90.00, $170.00 and $260.00. Level 1's side-by-side table has a "Change" column formatted with a plus sign (`+40`, `+$130`).

## Written without a number, or left out on purpose

23. **The game.** No `go` button on the last level. FinTech 10 students can open Venture Row and shop, work and invest there, but cannot found a company (`modules/ventures/constants.js`), and the companies there are not this section's example business, so no `go` button is used.
24. **No pictures yet.** No `image` fields. Prompts are in `design/art/ft10-s6-u6-prompts.tsv` (a banner and the 5 cards that have no table).
25. **Outcome codes**: FIN1910 3.2, 4.1.3, 4.1.4 (level 1); FIN1015 1.3, 1.4 and FIN1910 3.3 (level 2); FIN1910 2.2, 3.3, 3.4 and MAM3030 4.3 (level 3). MAM3030 4.3 asks to contrast risks with opportunities; the lesson names risks and what to do, and does not discuss opportunities. Please say whether that is enough.
26. **Changes from the starting plan**: level 1 is titled "Changes for the second day", not "Change one thing", because the partners changed two things (price and posters). Level 2's "what moved" explanation moved to its last card so the balance sheets come first. No term from outside the road or the company file's glossary is used.

## Added after the independent check (2026-11-11)

27. Level 1 card 4 now reads "The whole plan needed 85 pins at $5 to cover all its costs, and this one day sold 25 more than that." The 85 pins are a what-if for the whole plan (the first day really sold at $6).
28. Level 3 card 2 and questions 4 and 5: "1 cent adds $3" now says "before tariff" (with the 10% example tariff the landed cost moves by $3.30), and a point of tariff is said to be 1%. The moves of 3 cents and 2 points in the two questions are made up; no new rate or tariff rate is stated.
29. The unit's blurb now reads "Change the plan, compare the two rounds, and name the risks." (the partners change two things, the price and the posters).
30. After the six units were put together (2026-11-11): the first balance sheet in level 2 is now titled "Balance Sheet / The day the money is collected", the same title unit 4 gives the same balance sheet.
