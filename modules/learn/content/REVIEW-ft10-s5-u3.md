# Facts Mr. Tang must confirm: Debits and credits (`ft10-s5-u3`)

Unit 3 of Accounting Prep in `fintech10.json`. There is no lesson outline for section 5, so nothing here is "from your outline". The sources are your plan rows for Nov 30 and Dec 1 (levels 1 to 3), the FIN1015 outcomes 2.3, 2.6 and 2.7, and the running company in `modules/learn/companies/kirans-bike-repair.js` (Kiran's Bike Repair, approved 2026-11-11). Every dollar figure is imported from that file by the generator and recomputed by `test/learn-content-ft10-s5-u3.test.js`, which also checks that every "which account, which side" key matches the file's own entries. Please confirm or correct each item.

## Definitions and rules in our words, for Mr. Tang to confirm

1. **Debit is the left side and credit is the right side; neither means good, bad or more.** Level 1 card 1 and ft10-s5-u3-l1-q1. The first half is the company file's `GLOSSARY`; "not good, not bad, neither means more by itself" is our wording of your note, said once.
2. **Normal sides: assets, expenses and drawings grow on the debit side; liabilities, capital and revenue grow on the credit side; the other side makes the account smaller.** Level 1 cards 2 and 3 (the table on card 2 reads the `normal` field of the chart), ft10-s5-u3-l1-q2 to -q4. The sentence "Drawings have an account of their own" (card 2) is there so that a student does not debit capital for Kiran's withdrawal; the file's chart has Kiran, Drawings (302).
3. **Why the sides keep the equation true.** Level 1 card 3: assets sit on the left of the equation and grow on the debit side; liabilities and capital sit on the right and grow on the credit side; revenue raises owner's equity, so it grows on the credit side; expenses and drawings lower it, so they grow on the debit side. Our explanation.
4. **Every transaction has debits and credits of the same total, so the two sides of the equation change by the same amount.** Level 1 card 4, ft10-s5-u3-l1-q8, -q9. The first half is the glossary's definition of double entry; the second half is our wording.
5. **The form of a journal entry:** a date, the accounts debited first, then the accounts credited, the amounts and a short explanation. Level 2 cards 1 and 2, ft10-s5-u3-l2-q2. Our wording of the plan row. The explanation row in the card 2 table is the file's `what` line for Jun 2.
6. **The opening entry:** every asset debited; every liability and the capital credited; total debits equal total credits; the totals also match the opening balance sheet. Level 2 cards 3 to 5, ft10-s5-u3-l2-q3 to -q9. The first sentence of card 3 is the glossary's definition of the opening entry.
7. **The balance sheet table** on level 2 card 3 is titled "Balance Sheet, as at June 1" after the title lines of last year's case studies. The date has no year because the company file has none. The "Total liabilities" row is an extra row for the student's benefit.
8. **The mistaken entry** (ft10-s5-u3-l2-q8, -q9): the real opening entry with the Tools line moved to the credit column. The debits then total $5,600 and the credits $9,200, a gap of $3,600 (twice the Tools amount). Made up for the question; computed from the file.
9. **The ledger, one account per line of the chart in chart order, posting to the same side as in the entry, accounts that start empty are still opened, and the debit-side balances equal the credit-side balances.** Level 3 cards 1 to 6, ft10-s5-u3-l3-q1 to -q9. Definitions of ledger and posting are the glossary's. "Open an account for every line of the chart" and "both totals come to $7,400" are our wording. The list of six accounts that start empty is computed from the file.
10. **"Maya"** in ft10-s5-u3-l3-q9 is a made-up person who makes a posting mistake. No student is named.

## Figures

11. **Every dollar figure is from the company file** (opening balances, the Jun 2, 3, 5, 8, 10 and 12 entries, the totals $7,400 and the opening ledger balances). Nothing is retyped: `test/learn-content-ft10-s5-u3.test.js` scans every `$` amount in the cards, prompts, options, `why` and `working` lines and tables and fails on any amount the file does not produce.
12. **Tables** follow the section's layout: journal (Date, Account, Debit, Credit, debit line first), ledger page (Date, Debit, Credit, last row Balance on the normal side). Zero balances are asked as choice questions, never as number questions.

## Written without a number, or left out on purpose

13. **GAAP, trial balance, adjusting and closing entries, depreciation, GST, payroll and loan interest** are not mentioned; the test fails if they appear.
14. **The game.** Nothing about the game's own ledger or Venture Row is said, and the unit has no `go` button. Venture Row is for FT20/30 founding teams (`modules/ventures/index.js`: "FT20/30 founding teams register a company"), so a FinTech 10 student cannot open a company's statements there.
15. **Outcome codes** are `FIN1015 2.3` (level 1), `FIN1015 2.7` (level 2, the first half of the outcome: the opening entry) and `FIN1015 2.6` (level 3). The second half of 2.7, posting, is in unit 4 level 1.
16. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s5-u3-prompts.tsv` (a banner and one line for each of the 8 cards that has no table).

## Added after the independent review (2026-11-11)

17. **The check at the end of level 3 is a check of the posting, not a trial balance.** Card 6 now reads: "Check your posting: every line of the opening entry must appear once in the ledger, on the same side as in the entry. The debit lines add to $7,400 and so do the credit lines. If they differ, an amount was posted to the wrong account or to the wrong side." Questions 7 and 8 add the amounts posted on each side. A trial balance is outside this section, so the level does not name or teach one. If you would rather introduce the trial balance here, say so.
18. Level 3 card 5 now says the six empty accounts are opened "because later transactions will use them" (Utilities Expense is first used in July, not June).
19. Hints on level 1 questions 5 and 6 and level 2 question 7 no longer state the answer. In level 1 the right option of questions 2 and 3 moved to the last place (five of seven right answers had been in the second place).
