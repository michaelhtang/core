# Facts and wording Mr. Tang must confirm: Quick Cash Counter (`quickcash`)

The game is in `modules/arcade/ui/games/quickcash-core.js` (the figures and the 24 made-up customers) and `quickcash.js` (what students read). It is built from your lesson `ft10-s3-u4` ("Quick cash, real cost"); the facts below are the ones its review file (`modules/learn/content/REVIEW-ft10-s3-u4.md`, item numbers in brackets) already asks you about, plus what the game adds. `test/arcade-quickcash-core.test.js` recomputes every cost in the table from the formulas below with ordinary floats (365-day year, nearest cent) and checks the pool rules. **The game is not live. Its pay is decided (yours, 2026-11-25): one Today errand, "Play a round of Quick Cash Counter", 50 cents x the price index, the same as Debt Snake's; the score never pays. Please confirm or correct each other item before it is turned on.**

## The figures (the four kinds of borrowing)

1. **Payday loan: $15 for every $100 borrowed, charged again each payday; paydays are 14 days apart; the game uses 1, 2 or 3 paydays.** The cost to the customer is amount x $15 per $100 x paydays, in whole cents (for example $300 for 2 paydays is $90.00). Source: your class notes (review items 2, 3, 8). **Your Flag 4 (Lesson 23 outline, line 22) said to check the Alberta cap on alberta.ca before saying it. Decided by you on 2026-11-25: "just go with $15 per $100 payday cap".** So the $15 stays the figure from your class notes (the alberta.ca check was not done), used as written in the how-to card ("$15 for every $100"), on the offer buttons and in every payday cost in the table. The game never says "the cap" or "the maximum"; it just uses $15 for every $100 as the payday lender's fee, as the made-up lender's price.
2. **"Borrows it again every payday."** The wording on the card is "The customer borrows it again every payday (14 days apart) and pays the fee each time." It never says the customer borrows again to pay back the last loan, because the unit does not say that (review item 8). Three paydays is 42 days, so up to $270 on a $600 loan is the biggest payday cost in the pool.
3. **Cash advance: 23% a year for the days it is owed, plus a $5 fee.** Your example rates (review item 5). Simple interest, a 365-day year, rounded to the nearest cent: cost = amount x 23% x days / 365 + $5.00. For example $300 for 60 days is $11.34 + $5.00 = $16.34. The unit's own example (14 days) is the same maths; here the days are 14 to 365.
4. **Line of credit: 10% a year for the days it is owed.** Your example rate (review item 5). Cost = amount x 10% x days / 365 to the nearest cent. **It is never the most expensive offer for any customer: it has the lowest rate, which is what the game is meant to show.** The pool test checks this.
5. **Card balance carried: 21% a year for the days it is owed.** "A card at about 21% a year" (review item 16). Cost = amount x 21% x days / 365 to the nearest cent. **The town's credit card in the game starts at 20.99% (`CARD_APR_BP` in `modules/credit/constants.js`), not 21%. The lesson rounds it to "about 21%", and this game uses the round 21% exactly.** So a student who knows the town card's 20.99% will see a very small difference (about 1 cent in $100 of interest for a year). Please confirm that 21% is fine here, or tell me to use 20.99% (the costs would then be worked from 2099 hundredths of a percent and a few of the cents in the table would change by a cent or two). The lesson's own caveat applies: in real life a card in a shop costs nothing if it is paid in full before the due date (review item 6); the game's card kind is the carried balance only.
6. **A year is 365 days and every cost is rounded to the nearest cent.** Review item 5 says your note does not state the year; the lesson uses 365, so this game does too. 365 is odd, so no cost ever falls exactly on a half cent.
7. **Terms.** The payday loan is 1 to 3 paydays (the unit's own example goes to 13 paydays; the game stays short). The other three are 14 to 365 days in the pool. These are made up.
8. **The closing sentence:** "A parent, a friend, or a card paid off in full would have cost nothing in money." Your slide 7: "A and B cost nothing" (review item 6). I added "in money" because your slide 6 note says a friend can cost the relationship. Please confirm the wording.

## The 24 made-up customers

Amounts ($200 to $600), reasons (a few words) and terms are mine, not from your outline. Costs are worked out by the formulas above. The most expensive offer is the one the student should pick. Pool rules (checked by the test): every customer has all four kinds; the most expensive offer is a payday loan for 8 customers (rule: at least 6), a cash advance for 8 (at least 5), a card balance for 8 (at least 5) and a line of credit for none; the top two offers of every customer are at least $1.00 apart (the smallest gap is $1.70, Ethan); 8 customers have a gap of $10 or less (rule: at least 6), so those take thought.

| # | Name | Reason | Amount | Payday loan | Cash advance | Line of credit | Card balance | Most expensive (gap to next) |
|---|---|---|---|---|---|---|---|---|
| 1 | Maya | car repair | $300 | 2 paydays: $90.00 | 60 days: $16.34 | 120 days: $9.86 | 45 days: $7.77 | Payday loan ($73.66) |
| 2 | Jordan | rent is short | $500 | 1 payday: $75.00 | 365 days: $120.00 | 365 days: $50.00 | 250 days: $71.92 | Cash advance ($45.00) |
| 3 | Sam | broken phone | $250 | 1 payday: $37.50 | 30 days: $9.73 | 200 days: $13.70 | 300 days: $43.15 | Card balance ($5.65) |
| 4 | Priya | dentist bill | $400 | 1 payday: $60.00 | 365 days: $97.00 | 300 days: $32.88 | 300 days: $69.04 | Cash advance ($27.96) |
| 5 | Leo | winter tires | $600 | 3 paydays: $270.00 | 45 days: $22.01 | 180 days: $29.59 | 365 days: $126.00 | Payday loan ($144.00) |
| 6 | Ava | laptop repair | $350 | 1 payday: $52.50 | 200 days: $49.11 | 365 days: $35.00 | 320 days: $64.44 | Card balance ($11.94) |
| 7 | Noah | bus pass and food | $200 | 2 paydays: $60.00 | 20 days: $7.52 | 90 days: $4.93 | 150 days: $17.26 | Payday loan ($42.74) |
| 8 | Chloe | fridge stopped working | $450 | 2 paydays: $135.00 | 300 days: $90.07 | 365 days: $45.00 | 280 days: $72.49 | Payday loan ($44.93) |
| 9 | Ethan | hockey fees | $275 | 1 payday: $41.25 | 14 days: $7.43 | 100 days: $7.53 | 250 days: $39.55 | Payday loan ($1.70) |
| 10 | Zoe | vet bill | $325 | 1 payday: $48.75 | 200 days: $45.96 | 365 days: $32.50 | 365 days: $68.25 | Card balance ($19.50) |
| 11 | Mateo | school trip | $225 | 1 payday: $33.75 | 60 days: $13.51 | 150 days: $9.25 | 320 days: $41.42 | Card balance ($7.67) |
| 12 | Lily | glasses | $250 | 2 paydays: $75.00 | 180 days: $33.36 | 365 days: $25.00 | 200 days: $28.77 | Payday loan ($41.64) |
| 13 | Owen | furnace repair | $550 | 1 payday: $82.50 | 365 days: $131.50 | 365 days: $55.00 | 365 days: $115.50 | Cash advance ($16.00) |
| 14 | Nora | moving costs | $500 | 1 payday: $75.00 | 100 days: $36.51 | 180 days: $24.66 | 365 days: $105.00 | Card balance ($30.00) |
| 15 | Kai | phone bill | $200 | 1 payday: $30.00 | 180 days: $27.68 | 300 days: $16.44 | 140 days: $16.11 | Payday loan ($2.32) |
| 16 | Isla | car insurance | $425 | 1 payday: $63.75 | 300 days: $85.34 | 365 days: $42.50 | 330 days: $80.69 | Cash advance ($4.65) |
| 17 | Ravi | winter coat | $275 | 1 payday: $41.25 | 120 days: $25.79 | 200 days: $15.07 | 365 days: $57.75 | Card balance ($16.50) |
| 18 | Hana | uniform and shoes | $225 | 1 payday: $33.75 | 260 days: $41.86 | 365 days: $22.50 | 150 days: $19.42 | Cash advance ($8.11) |
| 19 | Finn | tooth pain | $375 | 1 payday: $56.25 | 90 days: $26.27 | 250 days: $25.68 | 365 days: $78.75 | Card balance ($22.50) |
| 20 | Tess | broken bike | $200 | 3 paydays: $90.00 | 40 days: $10.04 | 60 days: $3.29 | 30 days: $3.45 | Payday loan ($79.96) |
| 21 | Diego | power bill | $350 | 1 payday: $52.50 | 30 days: $11.62 | 365 days: $35.00 | 365 days: $73.50 | Card balance ($21.00) |
| 22 | Mia | textbooks | $400 | 1 payday: $60.00 | 250 days: $68.01 | 365 days: $40.00 | 190 days: $43.73 | Cash advance ($8.01) |
| 23 | Ben | a flight home | $300 | 1 payday: $45.00 | 365 days: $74.00 | 200 days: $16.44 | 310 days: $53.51 | Cash advance ($20.49) |
| 24 | Ruby | shoes for a job | $200 | 1 payday: $30.00 | 220 days: $32.73 | 365 days: $20.00 | 230 days: $26.47 | Cash advance ($2.73) |

Two things to check: (a) a 365-day cash advance or line of credit is a long loan for a $500 repair; the amounts are there to make the days matter, not to say what a real person would do; (b) a customer in the table with a $120 cost on a $500 loan (Jordan) can look like a "bad deal" for the borrower, which is the point: the game is about what the lender knows.

## Student-facing wording (every line, as it appears)

**The game's card, "How to play" (numbered):**
1. You work the loan counter at a made-up lender. 6 customers walk up one at a time. Each one is short some money.
2. Each customer is shown the same four ways to borrow, A to D, each for its own length of time. The order is different for every customer.
3. Pick the offer that costs the customer the most. That is what the counter earns. There is no calculator, so work it out in your head.
4. Press 1 to 4 (or A to D), or tap a button. You have 20 seconds for each customer. If the bar runs out, the customer leaves and the counter earns $0.
5. Interest is worked out on the amount borrowed, for the days it is owed. A year is 365 days.
6. After each pick you see what the counter earned, and whether it was the most expensive of the four.
7. After 6 customers the round is over. Your score is the whole dollars the counter earned. Then you see what every customer really paid, and what was cheapest for them.

**Tip:** "Tip: the highest rate is not always the most expensive offer. How long the money is owed matters too."

**The four kinds, one line each:**
- Payday loan. A fee of $15 for every $100 borrowed. The customer borrows it again every payday (14 days apart) and pays the fee each time.
- Cash advance. Cash taken out on a credit card. It costs 23% a year for the days it is owed, plus a $5 fee.
- Line of credit. Borrowing up to a limit a bank has set. It costs 10% a year for the days it is owed.
- Card balance. A credit card balance carried for a while. It costs 21% a year for the days it is owed.

**Credit line (under the four kinds):** "Quick Cash Counter is built from Mr. Tang's lesson, "Quick cash, real cost". The customers and amounts are made up."

**Tile and card blurb:** "You run the loan counter. Six customers each need cash. Pick the borrowing offer that costs them the most before they walk away, then see what they really paid."

**While playing:** "Customer 2 of 6"; "Maya needs $300 for car repair."; "20 seconds left"; "Get ready."; each button shows its letter and key, the kind's name, its short rate ("$15 for every $100", "23% a year + $5 fee", "10% a year", "21% a year") and its length of time ("2 paydays", "60 days").

**After each pick:** "+$90.00. The most expensive of the four!" or "+$16.34. Not the most expensive of the four." or "Maya left. The counter earned $0.00."

**End card:** "What each customer really paid"; for each customer "Maya: car repair, $300", "Your pick: Payday loan, 2 paydays. They paid $90.00. The most expensive of the four." (or "They left before you picked. They paid $0.00."), "Most expensive: Payday loan, 2 paydays, $90.00.", "Cheapest: Card balance, 45 days, $7.77."; then "The counter earned $412.30. 5 of 6 picks were the most expensive offer." and the sentence in item 8.

**Not in the game:** no store, brand or product names; no overdraft; no late-fee dollar figure; no payday rules beyond the $15 and the 14 days (no cooling-off, no limit on loans, no "the cap"); no talk of a student's own family. The test scans the wording for these.

## Decided, and still open (yours)

Decided by you on 2026-11-25:
- **Pay:** like Debt Snake. One Today errand, "Play a round of Quick Cash Counter" (50 cents x the price index, energy 1, priority 6), done when a finished round with at least one press emits `module.arcade.played_quickcash`, offered only while the game is on for the class. The score never pays; nothing else about money changes.
- **The $15 per $100 payday cap** (item 1): "just go with $15 per $100 payday cap". It is the figure from your class notes; the alberta.ca check was not done.

Still open:
1. **Whether the score should be dollars earned** (a student sees "score 412", meaning $412.30 earned, rounded down) or something else. It is the spec's choice and I have not changed it.
