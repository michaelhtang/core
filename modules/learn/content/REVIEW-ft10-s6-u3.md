# Facts Mr. Tang must confirm: The plan on paper (`ft10-s6-u3`)

Unit 3 of FinTech Marketplace in `fintech10.json` (3 levels, one for each of your plan rows Dec 16, Dec 17 and Dec 18). There is no lesson outline for section 6, so nothing here is "from your outline". The sources are your plan rows, the FIN1910, MAM1030 outcomes, and the example business in `modules/learn/companies/north-star-pins.js` (North Star Pins). **That business is made up, and you have not seen its figures yet.** Every dollar figure is imported from that file by the generator and recomputed by `test/learn-content-ft10-s6-u3.test.js`, which also fails on any `$` amount the file does not produce. Please confirm or correct each item.

## The choices that are yours (please decide first)

1. **The business form: a partnership of four students, with one equity line (Partners' Capital).** Level 1 cards 2 and 4. The company file says "a partnership of four students" and the lessons name no other form.
2. **The six section names and their numbers** are exactly `PLAN_SECTIONS`: 1 Business description and mission, 2 Marketing plan, 3 Production and operations, 4 Financial plan, 5 Forecast, 6 Risks and conclusions (level 1 card 1, ft10-s6-u3-l1-q2, -q8). The unit says nothing about sub-headings or length: your short plan template does not exist yet.
3. **Left out on purpose:** GST and any sales tax, income tax, wages, interest, depreciation, any real exchange rate or tariff rate, any named trade agreement, any named country. A test scans both units for those words.
4. **The example tariff and the rate** appear in unit 4, not here.
5. **Checkpoint 1.** Level 3 card 5 says "Use the same checks on sections 1 and 2 before checkpoint 1." That follows your plan row ("CHECKPOINT 1 (Sec 1-2)"). Nothing else is said about the checkpoint, because the row says nothing more. Please confirm the sentence.

## Definitions and rules in our words, for Mr. Tang to confirm

6. **Mission** is "one sentence that says what the business is for" (the file's `GLOSSARY`). The rule "it is not a sales goal and has no numbers" is our wording. Level 1 card 3, ft10-s6-u3-l1-q3.
7. **The North Star Pins mission sentence:** "We design enamel pins that students are proud to wear." Made up by us. Level 1 card 3.
8. **The bakery mission** (Hana and Luca, "We bake fresh bread for our neighbourhood every morning.") is a made-up word problem. It has no figures and is not a fact. ft10-s6-u3-l1-q3.
9. **The business description holds** the name, the form, the product, the designs and the market (level 1 card 2). That list is our choice of what a description says; your template may differ.
10. **Org chart** = "a list or drawing that shows who does which job" (the file's wording, with "list or drawing" as in the glossary). Level 1 card 4. The roles are the company file's: Amara Team lead, Devon Finance lead, Mei Production lead, Tariq Marketing lead. The four names are made-up people, not students.
11. **Memo**: a short written message to people inside a business, with the parts To, From, Date, Subject, message (level 1 card 5). "Choose the format before you write" and "put the point first, then say what you want done and by whom" are our wording of MAM1030 1.3, 1.11 and 1.12. The memo shown (Amara to all partners about the pin order) is made up.
12. **E-mail**: "a message sent on a screen. It may go to people inside or outside the business", with subject line, greeting, message and name (level 1 card 6). The sentence about who it may go to, and the order "subject line, greeting, message, name", are our wording.
13. **Business letter** is "a formal letter from a business to someone outside it" (the file's wording). "A memo stays inside the business" and "A personal business letter is one you write for yourself, such as a job application. A business letter is written for the business" (level 2 card 4) are our wording of MAM1030 1.4.
14. **The five jobs of a business letter**: sell products or services, request information, answer inquiries or complaints, build goodwill, keep a record (level 2 card 5). They are the outcome 1.5 list. We left out "written contract" (1.5.6) because nothing in the unit uses it. The line before-you-write (name the purpose and the reader, list the details, put the points in order) is our wording of MAM1030 1.6.
15. **The letter parts** are date, receiver, greeting, opening, body, closing, signature (level 2 card 6). The parts follow your brief. **No address is written**: the table says "The supplier's name and address". No e-mail address or phone number appears anywhere.
16. **The target market of North Star Pins** is "students who visit the school winter market" (level 2 card 1). The file does not state it; we read it from the market and from the survey of students. Please confirm.
17. **The 4 Ps table** (level 2 card 2) lists the product (enamel pins, Aurora and Bison), the price ($6 a pin, the first market day's price from `PRICE.round1`), the place (the school winter market) and promotion ("Posters and a display board with signs", from `FIXED`).
18. **Promotion** is the file's wording. "Go where the target market already is, and early enough that they can still come" and "posters and announcements at school, before the market day" (level 3 card 1) are our wording. The file has no cost for announcements, so none is given.
19. **Where each promotion tool is used** ("Where students walk" for posters, "At the market table" for the display board and signs; level 3 card 2) is made up for the example. The costs are `FIXED`: Posters $30, Display board and signs $45.
20. **Revising**: be brief, use active language, be clear (level 3 card 3, from MAM1030 1.14). The three example sentences are made up.
21. **Proofreading**: first check facts, dates, names and figures; then structure, grammar, spelling, punctuation and format (the outcome 1.15 list). "Do the facts first, so you do not polish a sentence that is wrong" is our wording. Level 3 card 4, ft10-s6-u3-l3-q7.
22. **The draft beside the plan** (level 3 card 5) is made up: it says 20 pins, $5 and "Mei" as Finance lead, where the plan says 200 pins, $6 and Devon. The $5 is also the `PRICE.round2` figure; the card does not say so.

## Figures

23. **Every figure is from the company file** and is recomputed in the test: the price $6.00 and the markup $3.00 (`PRICE`, `markupCents`; ft10-s6-u3-l2-q3), the cost per unit $3.00, the three competitor prices (`COMPETITORS`: sticker table $3, button stand $2, online pin shop $9; ft10-s6-u3-l2-q4, -q9: $9 - $3 = $6.00), the posters and display board costs (ft10-s6-u3-l3-q3: $30 + $45 = $75), and the price error (ft10-s6-u3-l3-q9: $6.00 - $5.00 = $1.00).
24. **The bars figure** (level 2 card 3) shows the three competitors and North Star Pins in cents (a `$` figure holds cents). The right answer to ft10-s6-u3-l2-q4 is the button stand, the lowest of the bars.
25. **Tables** have at most 4 columns. A document is shown as a two-column table of its parts (`Part | What it says`), with no line breaks.

## Written without a number, or left out on purpose

26. **The supplier letter** gives no smallest order and no delivery time: it asks for them. The file has no such figures.
27. **How long a plan or a section should be** is not stated.
28. **The game.** The unit has no `go` button. FinTech 10 students can shop, work and invest in Venture Row but cannot found a company there (`modules/ventures/constants.js`), so no `go` button is used.
29. **Outcomes** by level: level 1 FIN1910 2.1.1, 2.1.2; MAM1030 1.1.1, 1.1.2, 1.3, 1.11, 1.12. Level 2 MAM1030 1.1.4, 1.4, 1.5, 1.6, 1.8, 1.9 (and FIN1910 2.1.5 for the 4 Ps words). Level 3 FIN1910 2.1.5; MAM1030 1.7, 1.10, 1.14, 1.15. Outcome 1.7 (planning strategies for business documents) is only touched by "put the point first" and "name the purpose and the reader". Outcome 1.13 (sentence structure rules) is not taught beyond the proofreading list.
30. **No pictures yet.** The unit has no `image` fields. Prompts are in `design/art/ft10-s6-u3-prompts.tsv` (a banner and one line for each of the 6 cards that has no table or chart).
31. **Terms from unit 1 and 2** (target market, competitor, marketing mix, markup, cost per unit) are defined again in a few words, in the file's `GLOSSARY` wording.
32. **Where the starting plan changed:** the plan's level 2 asked for the 4 Ps "written down as a plan"; the card also shows the price against the three competitors (a bars figure) so the plan shows why the price fits. Level 3 has 5 cards, not 6, and 9 questions. No change to the three-level layout.

## Added after the independent check (2026-11-11)

33. **More of our own wording in the business-writing levels**, for you to confirm: "Be brief: cut words that add nothing" and "Be clear: say exactly what, and by when" (level 3 card 3; MAM1030 1.14 names only brevity, active language and clarity); "who, what and by when" as the reading of "specific actions" in MAM1030 1.3 (level 1 question 9, level 3 question 5); and "A proofreader compares each line with the plan" (level 3 card 5).
34. Level 1 question 3: the two wrong options no longer carry made-up figures (a count of loaves, a flour price). Level 3 question 5: the right sentence is now "Please tell us your delivery time by Friday.", so it also says by when, as card 3 asks.
35. After the six units were put together (2026-11-11): the Promotion row of the 4 Ps table in level 2 (card 2 and the questions that show it) now reads "Posters and announcements", the same words as unit 2's 4 Ps table. The display board and signs stay in level 3 as a promotion cost.
