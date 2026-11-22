# Facts Mr. Tang must confirm: A return by hand (`ft2030-s1-u5`)

Unit 5 of The Taxpayer in `fintech2030.json`, 3 levels, 17 cards, 29 questions (19 number, 10 choice), plan row Wed Nov 25 (FIN2060 2.3, "Manual return prep: fictional slips to T1 by hand"), outcome FIN2060 2.3. It replaces that class sheet: the student works Priya's whole return (scenario A of `taxpayers-2025.js`) step by step, each step a number question. `test/learn-content-ft2030-s1-u5.test.js` recomputes every amount from the taxpayers file (which reads the CRA 2025 rates in `tax-rates-2025.js`), and every line number from `tax-facts.js` (a draft that awaits your confirmation).

## Your choices, at the top

1. **Mr. Tang chose the 2025 tax year throughout (2026-11-15).** Level 1 card 2 says: "This return is for the 2025 tax year, the same year the tax program your class uses files in December." The same sentence is in unit 6 level 2 card 1. It rests on `YEAR.taxYearsFileable` (quote: file your 2018 to 2025 initial returns using NETFILE; the file flags that 2025 is the newest year in December as `inferred`), and it claims nothing else about the class's program.
2. **People and amounts are made up.** Priya, her T4 employment income ($27,500), her T5 interest ($63.50), her RRSP receipt ($1,200) and the income tax withheld in T4 box 22 ($1,420) are invented (`taxpayers-2025.js`). Box 22 is made up to fit the story (a refund); it is not the result of a payroll formula and does not match the game. The CPP and EI amounts on her T4 are worked out from the 2025 rates. The unit uses only Priya (scenario A); Marcus and Amara are not used.
3. **Simplifications.** Basic claims only: the basic personal amount, base CPP, EI and the Canada employment amount (federal), and the first three of those for Alberta. One RRSP receipt, assumed within her room. Alberta resident all year. No other deductions or credits (no tuition, donations or benefits). Her taxable income sits in the first band of both tax tables, so every tax step is one multiplication.
4. **The Alberta supplemental credit (K5P) is left out of the lessons.** It is $0 for Priya (the test checks it), so no card or question mentions it. The tax program may show a line for it.
5. **No `go` button.** The game does not file returns, and no building does what this unit teaches.
6. **Amounts are shown in the file's `money` style:** whole dollars print without cents ($1,200, $16,452, $250), the rest with cents.

## Real facts used (from `tax-facts.js` unless stated)

7. Line numbers and names, 2025 return: 10100 employment income, 15000 total income, 20800 RRSP deduction, 22215 deduction for CPP or QPP enhanced contributions on employment income, 23600 net income, 26000 taxable income, 30000 basic personal amount, 30800 base CPP or QPP contributions, 31200 EI premiums, 31260 Canada employment amount, 42000 net federal tax, 43700 total income tax deducted, 48400 refund, 48500 balance owing: used in l1 cards 3 to 6, l1-q1, q4, q8, q9; l2 cards 4 and 5, l2-q7, q10; l3 cards 3 to 5, l3-q6, q7. `T1_LINES`.
8. T4 box 14 goes on line 10100; box 22 on line 43700; box 18 on line 31200; box 16 feeds lines 30800 and 22215: l1 card 3, l1 card 5, l3 card 3, l3-q6. `SLIPS.T4` (box 16's quote names both lines). T5 box 13 is "Interest from Canadian sources" (`SLIPS.T5.box13`). No fact links the T5 box to a line, so the cards pair no line with it: they say the T5 interest goes into total income, line 15000. Line 12100 is not used on any card.
9. The unit says the line 22215 deduction is "a deduction for part of the CPP you paid". **The facts file holds only the line's name, not a plain description, so that wording is ours** (l1 card 5, l1-q4). It is also in the definitions list below.
10. **Federal and Alberta tax rates, band edges and credit amounts are the CRA 2025 figures in `tax-rates-2025.js`, each pinned to its page:** lowest federal rate and credit rate 14.5% for the whole of 2025 (the CRA's blended rate; the rate fell from 15% to 14% on July 1, 2025), first federal band up to $57,375 (l2 card 1); lowest Alberta rate 8%, first Alberta band up to $60,000 (l3 card 1); federal basic personal amount $16,129, Canada employment amount $1,471 (l2 card 4); Alberta basic personal amount $22,323 (l3 card 2). The tests check the cards against those pinned values.

## Amounts computed from the taxpayers file

11. Priya: total income $27,563.50; RRSP deduction $1,200; line 22215 deduction $240; net and taxable income $26,123.50; federal tax on taxable income $3,787.91; four federal credits $2,338.71, $172.26, $65.40 and $213.30, total $2,789.67; net federal tax $998.24; Alberta tax $2,089.88, three Alberta credits $1,785.84, $95.04 and $36.08, total $1,916.96; Alberta tax after credits $172.92; total tax $1,171.16; tax withheld (T4 box 22, made up) $1,420; refund $248.84 (line 48400). Used across l1 to l3.
12. The base CPP amount that earns a credit ($1,188) is box 16 ($1,428) minus the line 22215 deduction ($240): l1 card 5, l1-q5, l2 card 4, l2-q4. The unit does not explain how the split is made (the facts file gives no description); it states the amounts.
13. Rounding: each tax and each credit is rounded to the nearest cent, half up, as the taxpayers file does it; every prompt that needs it says so (l2-q1, q3 to q6; l3-q1, q2).
14. Without the RRSP deduction (computed from the taxpayers file's `returnFor` on a copy of her return with no receipt, in the test): taxable income $27,323.50, total tax $1,441.16, the same $1,420 withheld, so a balance owing of $21.16, not the $248.84 refund. The RRSP deduction lowered her total tax by $270, which is 22.5% (14.5% + 8%) of $1,200: l3 card 6, l3-q9, l3-q10. The card says each extra dollar in her first band is taxed 14.5% federal plus 8% Alberta.
15. Priya's slips are the same as in `ft2030-s1-u3` (both units read `taxpayers-2025.js`): T4 box 14 $27,500, box 22 $1,420, her T5 ($63.50) and RRSP receipt ($1,200).

## Definitions and rules in our words, for Mr. Tang to confirm

16. "A deduction for part of the CPP you paid" for line 22215: l1 card 5, l1-q4. The rest of box 16 earns a credit "which you use in level 2": l1 card 5.
17. "A band is a slice of income taxed at one rate": l2 card 1.
18. "Each credit here is an amount x the lowest federal rate" (and the Alberta version): l2 card 3, l3 card 2. This is how the taxpayers file computes them.
19. "If the credits were bigger than the tax, the answer would stop at $0": l2 card 5; from the glossary entry for a non-refundable tax credit.
20. "Total tax is net federal tax plus Alberta tax after credits": l3 card 3.
21. "A refund is the tax withheld minus the total tax, when that is above $0"; "if the total tax is more, the difference is a balance owing, line 48500": l3 cards 3 and 4. A refund and a balance owing are "two answers to the same subtraction" (our reading).
22. "A deduction is an amount you may subtract before tax is worked out" (l1 card 4), "total income minus the deductions is net income" and "no other deductions, so taxable income is the same amount" (l1 card 6). Net and taxable income are equal in this running example only.
23. Glossary terms on the questions (total income, deduction, taxable income, non-refundable tax credit, tax withheld, refund, balance owing) use the taxpayers file's `GLOSSARY` wording unchanged; the test checks them.

## Written without a number

24. Alberta tax and credits have no line numbers: `tax-facts.js` holds none for Alberta.
25. How the CPP splits into a deduction part and a credit part is not explained (no description in the file).
26. The Canada employment amount is described only as "an amount Priya gets in full because her pay is above it" (l2 card 4); the rule behind it is not stated.
27. The tax program's name, its amounts and how it differs are not given: the card says only that they will differ a little.
