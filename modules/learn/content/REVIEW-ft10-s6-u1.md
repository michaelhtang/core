# Facts Mr. Tang must confirm: The business idea (`ft10-s6-u1`)

Unit 1 of FinTech Marketplace (section 6) in `fintech10.json`, two levels: Dec 7 "What a business is" and Dec 8 "Who will buy". There is no lesson outline for section 6, so nothing here is "from your outline". The sources are your plan rows for Dec 7 and Dec 8, the outcomes of FIN1910, and the example business in `modules/learn/companies/north-star-pins.js` (North Star Pins). **You have not seen that company's figures yet; every figure in this unit is made up and is for you to confirm.** Every dollar figure is imported from that file by the generator and recomputed by `test/learn-content-ft10-s6-u1.test.js`, which scans every `$` amount in the unit and fails on any the file does not produce.

## Choices that are yours (please confirm first)

1. **The business form is a partnership with four partners.** Level 1 card 4 and ft10-s6-u1-l1-q3. North Star Pins is "a business owned by two or more people, called partners" (the file's glossary wording). Your note "Groups of 3-4 = pitch groups = plan groups" is used on level 1 card 6 as "Your group of three or four is your pitch group and your plan group."
2. **GST and any sales tax are left out; so are wages.** Nothing in this unit mentions them. The partners are not paid; they share the profit (said in the company file, not in this unit).
3. **The example tariff, the class exchange rate and the six plan-section names are not used in this unit.** They come in units 3 and 4.
4. **The class does not really sell.** Level 1 card 1 ("It is a plan on paper: your class does not really sell anything") and ft10-s6-u1-l1-q8. This follows your semester plan, which says the Marketplace is "fully simulated: plan only, nothing built or sold"; please confirm the wording. (The class business's sales rounds are simulated, not real sales.)

## Definitions and rules in our words, for Mr. Tang to confirm

5. **Which CTS courses FIN1910 draws on.** Level 1 card 2 (a table) and ft10-s6-u1-l1-q4. We map memos, e-mails, letters and speaking to Communication Strategies 1 (MAM1030; its speaking outcomes 2.1 to 2.3 are written for dealing with callers, so tying them to the pitch is our link), books, statements and the numbers to Accounting Prep (FIN1015), and buying from another country to Business in the Global Marketplace (MAM3030). The map is our reading of the outcomes (FIN1910 1, 1.1, 1.2: "connections between project and two or more CTS courses"); your own map may differ. Please correct the rows.
6. **Business, product, service, profit, partnership** use the company file's glossary wording (level 1 cards 3 and 4). Kiran's Bike Repair is named as the service business the road used earlier, and as owned by Kiran alone (the Accounting Prep file says Kiran is the only owner).
7. **The three tests of a workable idea** (people want it; a price they will pay that is above the cost; the group can really get or make it). Level 1 card 5, ft10-s6-u1-l1-q7 and ft10-s6-u1-l2-q10. These three tests are our wording, from the writing brief for this unit, not from a list of yours.
8. **Brainstorm.** Level 1 card 6 and ft10-s6-u1-l1-q9: "a quick list of many ideas; everyone adds ideas, and nobody says no until the list is long; then the group tests each idea and keeps the best." Our wording. It describes the idea only, not how your class runs its brainstorm.
9. **Sales** ("the money a business takes in from selling") is defined in the `terms` of ft10-s6-u1-l1-q5. The company file has no glossary entry for it; the wording is ours.
10. **Target market** is the file's glossary wording; the specific target market for North Star Pins ("the students at the school's winter market") is the file's `market`. "Everyone is too wide to plan for" (level 2 card 1) is our rule of thumb.
11. **Competitor table and competitive matrix.** Level 2 cards 2 and 3. The glossary defines competitor; "a competitor table lists them side by side" and "a competitive matrix gives each competitor a strength and a weakness; a weakness is a gap your business may fill" are our wording of your plan row's "competitive matrix". Please confirm that is what you mean by it.
12. **Survey** is the file's glossary wording. "A survey only tells you what these 40 students said; it does not say how many pins will sell" (level 2 card 6, ft10-s6-u1-l2-q9) is our rule of thumb.
13. **How the survey counts buyers.** Level 2 card 5: "A student who would pay up to $8 would also pay $6 or $4, so the buyers at one price are everyone whose highest price is that price or more", and the sales at a price are the buyers times the price "if each buyer takes one pin". This is how the company file's `buyersAt` works; the "one pin each" assumption is ours and is said on the card.

## Figures

14. **Every dollar figure is from the company file.** Competitor prices $2, $3 and $9 (`COMPETITORS`); pin price $6 and cost per unit $3 (`PRICE`, `unitCostCents`); survey prices $4, $6 and $8, and the buyers at each (24, 18, 6) and what each brings in ($96, $108, $48) from `SURVEY` and `buyersAt`; the $5 case in ft10-s6-u1-l2-q5 (18 students) is `buyersAt(500)`; $12 more at $6 than at $4 (ft10-s6-u1-l2-q8) is $108 - $96. The $60 sales and $30 profit of 10 pins (ft10-s6-u1-l1-q5, -q6) are 10 x $6 and 10 x ($6 - $3). The percent 60% (ft10-s6-u1-l2-q6) is 24 / 40.
15. **"Costs $3 to get ready to sell" appears before it is explained.** Level 1 card 5 and ft10-s6-u1-l1-q6 use the cost per unit of $3 without saying where it comes from; unit 2 level 2 names it (cost per unit) and says a later unit shows where it comes from.
16. **Tables** follow the section's layout (at most 4 columns, amounts through the file's `money`). One `bars` figure (ft10-s6-u1-l2-q7) holds cents.
17. **Game figures:** none. This unit uses no number from the game itself, so the price index does not apply.

## Written without a number, or left out on purpose

18. **No survey result is a prediction.** The unit says the survey shows what 40 students said, not how many pins will sell. No market size, no real statistic.
19. **The game.** The unit has no `go` button. FinTech 10 students can open Venture Row and shop, work and invest there, but cannot found a company (`modules/ventures/constants.js`), and the companies there are not this section's example business, so no `go` button is used.
20. **Outcome codes** are `FIN1910 1` (level 1 card 2), `FIN1910 2.1.2` and `2.1.3` (level 1: purposes and deliverables, as assigned in the writing brief), `FIN1910 2.1.5` (terms: both levels), `FIN1910 4.1.2` and `4.1.3` (level 2: manage information and use numbers).
21. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s6-u1-prompts.tsv` (a banner and one line for each of the 6 cards that has no table).

## Added after the independent check (2026-11-11)

22. Level 1 question 5: the hint shown for a wrong answer of $16.00 (10 + 6) could never appear, because it was stored for $6.10; it is fixed. Level 1 card 2 and question 4: the map row for Communication Strategies 1 now reads "Memos, e-mails, letters and speaking" ("pitches" is not in that course's outcomes).
