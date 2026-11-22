# Facts Mr. Tang must confirm: Posting and comparing (`ft10-s5-u4`)

Unit 4 of Accounting Prep in `fintech10.json`. There is no lesson outline for section 5, so nothing here is "from your outline". The sources are your plan rows for Dec 2, Dec 3 and Dec 4 (levels 1 to 3), the FIN1015 outcomes 2.7 and 1.3, and the running company in `modules/learn/companies/kirans-bike-repair.js` (Kiran's Bike Repair, with its `JUNE`, `JULY` and `COMPARE`). Every dollar figure is imported from that file by the generator and recomputed by `test/learn-content-ft10-s5-u4.test.js`. Please confirm or correct each item.

## Definitions and rules in our words, for Mr. Tang to confirm

1. **Posting: write the entry in the journal first, then copy each line to its account; a debit goes on the debit side of its account, a credit on the credit side.** Level 1 card 1, ft10-s5-u4-l1-q1. The definition of posting is the glossary's; the order is our wording.
2. **The balance of an account is the bigger side minus the smaller side, written on the account's normal side.** Level 1 card 3, ft10-s5-u4-l1-q8 (the Accounts Payable page). The file's `ledgerAccount` computes the balance the same way. A balance can be zero (level 1 card 4, ft10-s5-u4-l1-q9, asked as a choice because the number box cannot take zero).
3. **After June the equation still holds.** Level 1 card 6 and ft10-s5-u4-l1-q10. The owner's equity of $4,820 is the file's `equation(...)` result: capital, plus revenue, less expenses and drawings. The card says so in one clause. Our wording.
4. **Service, retail and corporation.** Level 2 cards 1 to 6. A service business sells work and has no goods to resell; a retail business buys goods and resells them. **Inventory** ("goods bought to be sold and not yet sold", an asset) and **cost of goods sold** ("what a sold part cost the business", an expense), and **gross profit** (sales minus cost of goods sold, before the other expenses) are not in the glossary; the wording is ours. Please confirm it is how you teach them.
5. **A corporation is owned by shareholders; its equity has Share Capital and Retained Earnings instead of one owner's capital; together they are its total equity.** Level 2 card 5, ft10-s5-u4-l2-q7 to -q9. "Share Capital is what the shareholders put in" and "Retained Earnings is the part of its earnings the business has kept" are our wording and say nothing about law, tax or how a corporation is formed. The test fails on those words.
6. **Pedal Parts' income statement** (level 2 card 3) is titled "Pedal Parts: Income Statement, one month" because `COMPARE` gives no month-end date; your layout "Income Statement / For the Month Ended <date>" is not used there. The two balance sheets are titled with the business name instead of "As at <date>" for the same reason.
7. **What stays the same in all three:** the accounting equation. Level 2 card 6, ft10-s5-u4-l2-q10. Wheelworks Inc.: $20,000 = $7,500 + $12,500 is computed from `COMPARE`.
8. **Level 3 (the check-in) teaches nothing new.** Its cards 1 and 2 are short reminders of the sides and the equation, card 3 is the opening balance sheet (used by ft10-s5-u4-l3-q10), card 4 is the July list from the file, and card 5 is one calm closing sentence for the section ("You have opened a set of books, posted a month and kept the equation true. Each step was the same small step, repeated."). Please confirm you want that sentence to close the section.
9. **July is new to the student.** The July questions (ft10-s5-u4-l3-q1 to -q7) ask for the debit and the credit in the form "Debit X, credit Y"; Jul 10 "Paid the power bill in cash" is Utilities Expense, which the chart of accounts in unit 2 lists but never explains, so level 3 card 4 now says "Utilities Expense is the account for bills such as power."
10. **The loan payment** (Jun 25) appears in the Cash page of level 1 card 2 but is not asked about. Your plan wants one card in the section to say that the payment in the example is principal only; that card is unit 2 level 2 card 5 ("Rules and accounts").
11. **"Dana"** (owner of Pedal Parts) comes from `COMPARE`. No student is named anywhere in the unit.

## Figures

12. **Every dollar figure is from the company file** (June and July amounts, balances after the first n transactions, the June and July equation, `COMPARE`). `test/learn-content-ft10-s5-u4.test.js` scans every `$` amount in the cards, prompts, options, `why` and `working` lines and tables and fails on any amount the file does not produce, and recomputes each number answer and each "which account" key.
13. **June's closing figures:** assets $7,070, liabilities $2,250, owner's equity $4,820. July's: assets $7,250, liabilities $2,340, owner's equity $4,910.
14. **Tables** follow the section's layout (journal, ledger page with a Balance row, two-column statements of at most 12 rows). No bars or lines are used.

## Written without a number, or left out on purpose

15. **No law, tax or formation rule** for a corporation, and no named accounting standard. GAAP is not mentioned in this unit.
16. **The game.** The unit says nothing about the game's ledger or Venture Row and has no `go` button. Venture Row is for FT20/30 founding teams (`modules/ventures/index.js`: "FT20/30 founding teams register a company"), so a FinTech 10 student cannot open a company's statements there. The Net Worth building is a personal balance sheet, not a business one, so it is not offered either.
17. **Outcome codes** are `FIN1015 2.7` (level 1, posting, the second half of the outcome; level 3 reviews it) and `FIN1015 1.3` (level 2).
18. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s5-u4-prompts.tsv` (a banner and one line for each of the 9 cards that has no table).

## Added after the independent review (2026-11-11)

19. **"Utilities Expense is the account for bills such as power."** (level 3 card 4). Our wording; please confirm.
20. Level 3 question 10: the balance sheet beside it no longer shows the Total liabilities row, which was the answer.
21. Level 2 question 10: the explanation of one wrong option now says "Only a business that resells goods has it" (no card says a business can make goods). Hints on level 1 question 3 and level 3 questions 2 and 4 no longer state the answer.
