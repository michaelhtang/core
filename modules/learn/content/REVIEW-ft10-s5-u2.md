# Facts Mr. Tang must confirm: Rules and accounts (`ft10-s5-u2`)

Unit 2 of Accounting Prep (`ft10-s5`), levels for plan days Nov 26, Nov 27 (first half) and Nov 27 (second half) (outcomes FIN1015 1.2, 2.4, 2.5). There are no lesson outlines for this section, so nothing here is quoted from an outline: every dollar figure about the shop is read from `modules/learn/companies/kirans-bike-repair.js` and recomputed in `test/learn-content-ft10-s5-u2.test.js`, and every definition and rule below is our own wording. Please confirm or correct each item.

## Definitions and rules in our words, for Mr. Tang to confirm

1. **GAAP as an idea only.** Level 1 card 2: shared rules for keeping books, there "so a statement can be trusted, and so two businesses can be compared" (the company glossary's sentence). The unit names no principle, no rule-maker, no law and no country's rule book; the only words that come close are "generally accepted accounting principles", the expansion in the company glossary. Used in `ft10-s5-u2-l1-q1`.
2. **Four made-up examples of what goes wrong without shared rules**, each with its effect: a personal bill counted as a shop expense (expenses too high, net income too low; level 1 card 4, `-l1-q2`, `-q3`, `-q4`); a tool written at a hoped-for value (assets too high, and the owner's share with them; card 5, `-l1-q5`, `-q6`); two shops counting the same $200 bike stand in two ways (card 6, `-l1-q7`); a shop that changes how it counts each month (card 6, `-l1-q8`; `-l1-q9` asks which case is the kind of problem shared rules fix). All amounts ($50, $300, $2,500, $200) are made up.
3. **The $200 bike stand example previews unit 2 level 2.** One shop counts it as an asset and the other as a cost of June, and the questions say the two shops show net incomes $200 apart. That follows the file's treatment (a tool bought for cash is an asset, Jun 28) and the expense definition. Please confirm you are happy to preview it here.
4. **Revenue, expense and net income wording** (company glossary, shortened). Level 1 card 3 and level 2 cards 1 to 3. June's figures come from the file: revenue $750, expenses $680, net income $70.
5. **Revenue on account is counted on the day the work is done.** Level 2 card 1: "Kiran counts the $300 on Jun 8, when the work was done." This is how the file records Jun 8 (Accounts Receivable and Repair Revenue on the same day), written as a plain statement. It is our wording; the unit does not name a rule for it. Used in `-l2-q2` and `-l2-q5` (the Jun 15 payment is "neither", because the $300 was counted on Jun 8).
6. **The income statement's title lines**: "Kiran's Bike Repair / Income Statement / For the Month Ended June 30" (level 2 card 3). The brief gave the format from your case studies; I did not open them. "June 30" is the last day of the month; the file's transactions end on Jun 28.
7. **Drawings is not an expense** and why: "the owner taking out their own share, not a cost of running the shop". Level 2 card 4; `-l2-q6`. The file's glossary says drawings lower the owner's equity and are not an expense; the reason is our wording.
8. **A loan payment and buying a tool are not expenses**, because each changes assets and liabilities (or two assets) and leaves the owner's equity alone. Level 2 card 5; `-l2-q7`, `-q8`. The card says the loan payment is principal only; it says nothing about interest.
9. **The three-question sort** (earned from work: revenue; used on a cost of running the shop: expense; otherwise neither) and the sort of the ten June transactions: two revenue (Jun 5, Jun 8), two expense (Jun 2, Jun 12), six neither. Level 2 card 6; `-l2-q5` to `-q8`. The six are computed from the account types in the file by the test.
10. **Equity at June 30 is $4,820** ($5,000 + $70 net income - $250 drawings). `-l2-q9`; from `equation(balances(JUNE))`.
11. **Chart of accounts**: an account is "one page of the books that tracks one thing"; the five kinds; the first digit of a number tells the kind (100s assets, 200s liabilities, 300s owner's equity, 400s revenue, 500s expenses). Level 3 cards 1 and 2. This matches every account number in the file (the test checks all 13). The count "uses 13" is `ACCOUNTS.length`.
12. **Kiran, Drawings is listed with owner's equity** in the 300s (card 4; `-l3-q5`), as the file does (type equity, number 302).
13. **"The numbers leave gaps"** (card 3) and "an unused number in that hundred does the rest" (card 6) are our reading of the file's numbering (101, 110, 120 ...). The unit never gives a number to a new account.
14. **A delivery bike is an asset (100s) and a phone bill is an expense (500s)**, `-l3-q6`, `-q7`. The file has no phone or delivery bike account, so these are our examples; it has Tools and Equipment (assets) and a Utilities Expense account for the power bill, and the questions name only the kind and the hundred.
15. **The chart follows the balance sheet first, then the income statement** (card 5; `-l3-q8`). Our description of the order the file uses. The file does not say why it is ordered that way.

## Numbers

16. **Every dollar figure about Kiran's Bike Repair** is read from the company file and recomputed in the test, including the two tables of the chart and the opening balances in `-l3-q9` and `-q10`.
17. **Made-up arithmetic, not facts**: the $50 and $300 personal bills, the $2,500 hoped-for tool value, the $200 bike stand, and a made-up month with revenue $500 and expenses $560 (`-l2-q10`, net loss $60; $1,060 is the wrong option that adds). Derived from them: net income $20 with the wrong $50 bill, a net loss of $230 with the wrong $300 bill, total assets $8,100 with the tools at $2,500.
18. **Written without a number**: nothing from outside the company file is stated. No tax rule, law, statistic or standard-setter; no game price or rate is used, so the price-index note does not apply.

## The game

19. Nothing about the game is said, and there is no `go` button. The Net Worth building is used in unit 1 level 3.

## Added after the independent review (2026-11-11)

20. **Tools stay in the books at what was paid** (level 1 card 5: "A hoped-for price is a guess. The books keep the tools at what was paid."). Our wording, with no rule named. Please confirm, and note the difference from the Net worth unit (`ft10-s3-u8` level 2), which counts a person's things "at what they could sell for today, not at what was paid". A student may ask why the two differ.
21. Level 1 card 1 now ends "A reader cannot compare them, and cannot trust the numbers that use a hoped-for price." (it used to say neither set could be trusted, which did not agree with card 5).
22. Level 3 question 10 ("The 300s"): the table beside it no longer shows the Kiran, Capital row, which was the answer.
