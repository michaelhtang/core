# Facts Mr. Tang must confirm: Rights and responsibilities (`ft2030-s1-u4`)

Unit 4 of The Taxpayer in `fintech2030.json`, 2 levels (plan row Mon Nov 23, FIN2060 1.6), outcome FIN2060 1.6. **`modules/learn/companies/tax-facts.js` is a draft read from official pages on 2026-11-15 and awaits your confirmation.** Every real fact below is keyed to that file (`tax-facts.js` key, then the page it holds); `test/learn-content-ft2030-s1-u4.test.js` recomputes them from it.

## Your choices, at the top

1. **Mr. Tang chose the 2025 tax year throughout (2026-11-15).** The deadlines in l2 are those of the 2025 return (items 9 to 11). The 2026-return facts stay in `tax-facts.js` as extras and the unit does not use them.
2. Everything real comes only from `tax-facts.js`. Wording follows each fact's `quote`, not its longer `say`, where they differ. Right titles are quoted exactly as the file holds them.
3. The Taxpayer Bill of Rights is taught as a selection: 16 are counted and 11 are quoted in level 1. It is not a list to memorise. Not quoted: the rights to a service complaint with an explanation of findings, to have the costs of compliance taken into account, to expect the CRA to be accountable, to expect published service standards, and to be warned about questionable tax schemes.
4. No number question: the course's number box only takes `$`, `%` or `hours`, so counts and day counts are choice questions with the figure as the option text.
5. Left out: "tax software account setup" from the plan row (the file has no account-setup steps), keeping records (the file has no quote about it; only "gather your documents"), and any interest arithmetic (the file gives no rate). No `go` button. A side job paid in cash is not used: the file does not settle it.

## Real facts used

5. The Taxpayer Bill of Rights lists 16 rights: l1 card 1, l1-q1. `RIGHTS.count`, TBOR page.
6. Right titles quoted in l1 cards 2 to 5 and used in l1 questions 2 to 9 (q9 is a made-up scenario settled by the right to have the law applied consistently): `RIGHTS.list` entries 1, 2, 3, 4, 5, 6, 7, 8 (entitlements), 12, 15 and 16 by the page's numbering. The test checks every quoted title and every option in l1-q2 to q9 is a title in the file.
7. Our reading of a few titles, for you to confirm: "entitlement" is something the law says you are owed, such as a refund (l1 card 2; from `RIGHTS.list[0].say`); "reprisal" means being punished for it (l1 card 4; from the `say` of right 16); "impartial" means fair (l1 card 5).
8. Relief from penalties and interest because of extraordinary circumstances: l1-q5 states the circumstances as extraordinary without saying what counts, because the file does not.
9. Filing deadline for most people, 2025 return: April 30, 2026: l2 card 2, l2-q1, l2-q3. `FILING.deadline2025Return` ("April 30, 2026 : Deadline to file your taxes") and the rule `FILING.deadlineMost` ("Filing due date is April 30 for most taxpayers", CRA important dates page): April 30 of the year after the tax year.
10. Self-employed (the card and l2-q2 say you or your spouse or common-law partner), 2025 return: June 15, 2026: l2 card 2, l2-q2. `FILING.deadlineSelfEmployed2025Return`.
11. Deadline to pay tax owing for 2025: April 30, 2026: l2 card 2, l2-q4. `FILING.paymentDeadline2025`. The file gives no separate payment date for the self-employed, so no question asks about one.
12. Day counts for made-up people: Kim files April 12, 2026, so 18 days before April 30 (l2-q3); Jo pays May 6, 2026, so 6 days after April 30 (l2-q4). Arithmetic only, recomputed in the test.
13. Five responsibilities (doing your taxes by the deadline; giving accurate and complete information; paying your balance owing; correcting your taxes; updating your personal information): l2 card 1, l2-q7 to q10. `RIGHTS.responsibilities`, CRA "Purpose of taxes" page. The file notes the Taxpayer Bill of Rights page itself lists no responsibilities. The source page is a CRA educational page about why we pay taxes, not a CRA rule or list of obligations; l2 card 1 no longer calls it a lesson or a list, and ties each responsibility to its own fact on the cards that follow. **Please confirm** this source is good enough for these five.
14. A balance owing is also due April 30; compound daily interest as of May 1 if unpaid by the due date: l2 card 4, l2-q5. `RIGHTS.lateBalance`, `RIGHTS.responsibilities[2]`. No rate is in the file, so no interest is computed.
15. A mistake on a return, or details of income left out, can be corrected; personal information such as an address should be updated: l2 card 5, l2-q7, l2-q8. `RIGHTS.responsibilities[3]` and `[4]` (the page also mentions marital status; only the address is used).
16. Slips show the income paid and the amounts taken off; gather slips such as T4s, and receipts: l2 card 3. `T1_LINES.slipsShow`, `T1_LINES.documents`.

## Definitions and rules in our words, for Mr. Tang to confirm

17. "A responsibility is something you are expected to do": l2 card 1.
18. "A balance owing is the tax you still owe when you do your taxes": l2 card 4, l2-q5 term.
19. "Compound means interest is charged on the interest already added": l2 card 4, l2-q6. The file's quote says only "compound daily interest".
20. "In dispute: not agreed; the taxpayer and the CRA see the amount differently": l1-q8 term.

## Written without a number

21. Interest on a late balance has no rate or dollar example (not in the file).
22. Keeping records, and how long to keep them, are not taught (not in the file).
23. Tax software account setup is not taught (the file holds ways to file and NETFILE, not account steps).
