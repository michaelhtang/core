# Facts Mr. Tang must confirm: What Edmonton costs (`ft10-s1-u4`)

Unit 4 of Money & You in `fintech10.json`. The class figures (rent, bus pass, car range, yearly totals) come from your Lesson 6 outline of Sept 14, Parts A to C. Part D (budget methods) is not taught here. The game figures in level 8 come from `modules/housing/constants.js` and are recomputed by `test/learn-content-ft10-s1-u4.test.js`. Please confirm or correct each item.

## Figures from your outlines

1. **1-bedroom $1,298 and 2-bedroom $1,581 (Edmonton averages).** Written as $1,298.00 and $1,581.00. Source: Sept 14 outline slide 3 (lines 69 and 74), whose own source is the Alberta Regional Dashboard, Average Residential Rent, 2025 (Sources, line 237). Used in level 2 cards 4, ft10-s1-u4-l2-q4 to -q9, level 3, level 6.
2. **Bus pass $105 and car $680 to $1,150 a month, all in, midpoint $915.** Source: Sept 14 slide 5 (lines 90 and 92); its source is "Cost of Living in Edmonton 2026", WealthNorth (line 238). Used in level 5 and level 6.
3. **"All in" means the payment, insurance, fuel, maintenance and registration, and at a young driver's age insurance is the biggest single piece.** Source: Sept 14 slide 5 say-line (line 92). The unit states it as the outline does, with no figure for insurance. Level 5 card 2, ft10-s1-u4-l5-q1, -q2. (Your Sept 11 outline adds that insurance is often larger than the payment on a used car; that is not used.)
4. **$2,503.00 a month on the bus, $3,313.00 with a car.** Source: Lesson 1 outline (line 16) and Lesson 5 outline (line 57). Level 1 cards 2 and 3, level 5, level 6. The Open House outline (line 35) says the $2,503 is "1-bedroom, groceries, bus pass, phone, utilities", which is the list I used.
5. **Derived, not written anywhere: "groceries, phone and utilities together are $1,100.00".** It is $2,503.00 - $1,298.00 - $105.00. Level 1 card 3, ft10-s1-u4-l1-q5, bars in -q7. It assumes the $2,503 uses the $1,298 average and the $105 pass. The $3,313.00 equals $2,503.00 - $105.00 + $915.00, so the car month in your Lesson 1 outline uses the car midpoint. I checked that sum; tell me if you built $3,313 another way.
6. **$15.00 an hour, 406 hours, "about 8 hours a week".** Source: Sept 14 slide 3 say-line (line 74, "about 406 hours, or roughly eight hours a week"). The lesson says "before deductions", because 406 hours at $15.00 earns $6,090.00 gross, not after CPP and EI. Level 3 card 3, ft10-s1-u4-l3-q3, -q4, level 4 q8, level 6 q5.
7. **On the books at $15.00 against $17.00 cash.** Source: Sept 14 slide 7 (line 112). The 52 hours a month is the student month from the pay unit (12 hours a week), my choice. Level 7 card 1, ft10-s1-u4-l7-q1, -q2.
8. **CPP, EI and no income tax for that month.** From `payroll.js` through `payStub` ($780.00 gross: CPP $29.06, EI $12.71, income tax $0.00, net $738.23). Card 2 of level 7 gives the rates 5.95% above $291.66 and 1.63%, as in the pay unit. The "no income tax at a part-time student income" line follows Sept 14 slide 8 and your Lesson 4 outline (slide 13, line 65).
9. **Ethics, as the outline puts it.** Level 7 follows slide 8: no CPP credit, no EI, no record of income (for a loan, a lease or a mortgage), no T4 so no return, and "you would have gotten your withheld tax back anyway". The unit says cash pays more per hour and does not claim cash is a bad deal in dollars alone: with the CPP and EI lines, cash puts $145.77 more in hand in that month ($884.00 against $738.23), of which $41.77 is what the CPP and EI lines buy. Your slide says "two dollars an hour" is all you gained, which is true of gross pay; the unit says "before deductions" and shows the stub. Please check that you are happy with that wording.
10. **Statements of law, each as short as the outline has them.** (a) "Not reporting income is illegal for the employer and for you. The worker is not automatically the innocent one." Level 7 card 5, ft10-s1-u4-l7-q7. Source: slide 8 lines 123 and 125. No other statement of law is made. No penalty, no agency and no rule is named.
11. **The test for honest dealing**: "would you be comfortable if the other person knew everything you know?" Level 7 card 6, ft10-s1-u4-l7-q8 to -q10. Source: slide 9 (line 131). The unit gives no separate definition of ethical conduct; it teaches the test itself, in your words that a deal should survive being fully visible. Outcomes 1.1, 1.2, 1.3 are listed from the Objectives (Sept 14 lines 6 to 8).
12. **Sorting the four cases.** Your slide 9 says one case is fine, one is illegal and two are "the uncomfortable middle", and it does not say which two. The unit does not sort all four into your three headings. It uses the test: a raise passes (fine); keeping quiet about a $200 overpayment fails (ft10-s1-u4-l7-q10); tips not earned on a credit application fails (option in -q9); cash off the books is called illegal on a card (-q7). I did not call the credit-application case "legal but not ethical" or "illegal", because the outline does not. Your Sept 11 outline calls inflating income on a rental application fraud. Please say if you want it sorted.

## Where your Sept 11 and Sept 14 outlines differ (Sept 14 used)

13. **Stay at home.** Sept 11 gives $200 a month. Sept 14 gives no figure ("no prices yet"). The unit teaches home as "usually the cheapest" with no number; the game's $400.00 appears only in level 8.
14. **Roommates.** Sept 11 labels the $790 "two roommates" (the 2-bedroom split). Sept 14 says one roommate, half of the 2-bedroom. The unit says one roommate, half.
15. **Transport and the rest of Sept 11 are not used.** The 30% rule, the share of a $2,192 take-home, the combination table (home plus bus $305 and so on, alone plus car $2,213) and the three Sept 11 ethics questions (everyone did it, someone loses) are left out. Sept 11's four cases (32 hours paid for 28, a mistaken $400 e-transfer, a recruit-your-friends app) are not used either. The Sept 14 outline has one test and four short cases.
16. **$2,203 and $1,696 "needs" (Sept 14 slide 12) are not used.** They belong to budget methods. They also do not equal $2,503: $2,503.00 - $2,203 = $300, which is not the phone figure ($40 to $80, Lesson 7 outline line 126). Worth a look before the next unit.

## Rounded slide figures I did not copy

17. **Slide 3:** $790 (half of $1,581 is $790.50), $508 (the difference is $507.50). The $6,090 a year was computed from the unrounded $507.50 (12 x $507.50 = $6,090.00), so the unit uses $790.50 and $507.50 and still ends at $6,090.00. Level 2 card 4, level 3.
18. **Slide 6:** $1,318 a month (the sum is $1,317.50). $15,810 a year is exact (12 x $1,317.50). Level 6 card 1. The yearly roommate rent in level 3 q9 ($9,486.00) and the figure in -q6 are computed the same way.

## Numbers from the game (level 8)

19. **Game rents and deposits** (`RENTALS`, checked 2026-10-22): living with parents $400.00 a month, deposit $0.00; 1-bedroom $1,290.00, deposit $1,290.00; 2-bedroom $1,635.00 whole, so the roommate way is $817.50, deposit $817.50 (one month of your own rent). The card says plainly that the game's rents "were looked up at a different time". Used in level 8 cards 2 to 5 and ft10-s1-u4-l8-q1 to -q9.
20. **Pairs that differ between the class and the game:** 1-bedroom $1,298.00 against $1,290.00 (the game is $8.00 lower); split 2-bedroom $790.50 against $817.50 (the game is $27.00 higher); whole 2-bedroom $1,581.00 against $1,635.00; monthly roommate saving $507.50 against $472.50; yearly saving $6,090.00 against $5,670.00; living at home $200 (Sept 11 only) against $400.00. The bus pass in the game's Bills catalogue is $100.00 against your $105.00; the unit does not quote it, and the game has no all-in car cost (only a car insurance and gas line), so the unit says nothing about the game for transport.
21. **Wages and prices on a student's own screen** are the catalogue figure times the town's price index, so the game rents on a student's screen equal level 8 only while the index is 1.00. If prices in the town have risen, the screen shows a little more.

## Written without a number

22. **Buying a home.** Level 2 says buying is "the most expensive of the four" at 22 and that you pay a mortgage and the costs of owning. No price, down payment or rate appears. The ranking is taken from the order of your slide 2 ("rank them cheapest to most expensive": home, roommates, alone, buy); your outline does not give a buying cost. Please confirm the ranking is what you want students to take away.
23. **What staying at home includes.** Level 2 card 2 says home "usually means a contribution to the household instead of rent". The word "contribution" is from your Sept 11 table; the amount is not given.

## Not reproduced

24. The "pair, rank the four ways" activity, the "hands up, who takes the cash" activity and the sorting game are not described as activities. The unit teaches the ideas underneath them. All people in the unit are made up (Wen, Rae, Lee, Sam, Mia, Noor, Ali, Ana, Ari, Sol, Aiden, Zara); their amounts ($300.00 of value, a $1,500.00 2-bedroom, Sam's $2,635.00 net pay) are arithmetic, not facts.

## Added after the independent review (2026-11-10)

25. Level 1 card 3, ft10-s1-u4-l1-q5 and ft10-s1-u4-l1-q7 call the $1,100.00 left after rent and the bus pass "everything else", not "groceries, phone, utilities". Your Sept 14 and Sept 15 outlines give groceries $370 to $490, utilities $280 to $460 and phone $40 to $80, which add to at most $1,030, so the $1,100.00 cannot be built from those three alone. If you have the full breakdown of the $2,503 month, give it and the table can list every part.
26. Level 8 card 4, ft10-s1-u4-l8-q1 and ft10-s1-u4-l8-q7 say the game's rents differ from the class averages "because they come from different sources and dates". Class: the Alberta Regional Dashboard figure in your outline. Game: the notes in `modules/housing/constants.js` (Rentals.ca and Nesto, 2026; the roommate split is marked illustrative).
27. ft10-s1-u4-l7-q9 now asks which case is "legal and also passes the test", because in a cash deal the boss already knows everything, so the test alone does not rule it out.
