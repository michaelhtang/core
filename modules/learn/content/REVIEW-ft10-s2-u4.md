# Facts Mr. Tang must confirm: Risk and return (`ft10-s2-u4`)

Unit 4 of Investing Foundations in `fintech10.json`, written from Blocks B and C of your Lesson 11 outline (slides 4 to 8) and the Exchange constants of the game. Slides 1 to 3 (compounding) and slide 9 are not used. Every game figure is recomputed from `modules/exchange/constants.js` and every number answer from its prompt by `test/learn-content-ft10-s2-u4.test.js`. Please confirm or correct each item.

## Figures and claims from your outline

1. **The class example: a savings account at about 1.5%, a stock that might gain 8% or lose 30%.** Quoted as "the class example" in level 5 card 2 and in ft10-s2-u4-l5-q6 (the 1.5%). Source: Lesson 11 outline, slide 7 (line 179). They are not presented as current rates.
2. **The ten kinds and their one-line descriptions** (savings account, GIC, government bond, corporate bond, one company's stock, index fund, mutual fund, real estate, gold, crypto). Level 2 cards 2 and 3 follow the card lines in slide 4 (lines 94 to 103) in my own words. "ETF" is left out of the index fund name: the unit says "index fund" only.
3. **The order, safest to riskiest.** Level 3 card 5 shows your slide 5 order (lines 113 to 122) with real estate left out, because your speaker note (line 126) says real estate moves anywhere between places 4 and 9. The questions ask only the comparisons the outline treats as settled (savings account at the safe end, government bond before corporate bond, index fund before one stock, crypto at the risky end, and pairs of those). Level 3 card 6 says the middle is arguable (a mutual fund can be safer than a bond, real estate could sit almost anywhere), as your note on slide 5 does. The unit never asks the student to rank a mutual fund against a bond, or to place real estate or gold relative to a stock.
4. **"Savings account: insured, the number can't go down"; "governments almost never fail to pay"; "a company can fail"; "one company can go to zero"; "gold and crypto swing hard, nothing but what the next buyer will pay".** Level 3 cards 2 to 4 and the options' `why` lines follow slide 5 (lines 113 to 122). The word "insured" is yours; the unit does not name an insurer.
5. **Liquidity: "how fast you can turn something into cash without losing value".** Level 4 card 1 follows the TYPE THIS box after round 2 (line 164). The speeds on level 4 cards 2 and 5 ("today", "minutes", "a day or two", "when the term ends", "months") follow slide 6 (lines 146 to 155) and are labelled the class example. The unit drops your "2 to 3 days" for mutual funds and the bond and gold rows, and asks only the extremes and the crypto surprise.
6. **"Emergency money needs liquidity, not high returns"; "safe and locked"; "risky and liquid".** Level 4 cards 3, 4 and 6 and l4-q2, q5, q9 follow lines 159 to 169.
7. **Higher expected return is the payment for accepting risk.** Level 5 cards 1 and 2 follow slide 7's "Say" (line 181). "Expected" is explained as an average of possible outcomes, which is my wording, not the slide's.
8. **The four questions** (when do I need it back, how much do I need, how fast can I get it out, will I lose sleep). Level 6 cards 1 to 4 follow slide 8 (lines 187 to 190). The fourth question is worded as "how will I feel when it drops?" and keeps your point that it is real, not a joke. The outcome-code topics (time horizon, cash requirement, liquidity, emotional factors) are the Objectives line 2.6.
9. **A rule beats a mood.** Level 7 teaches the idea under your Lesson 12 outline (decide a rule in advance; selling in a crash locks the loss in; a good rule improves the odds, it does not guarantee a result). It uses made-up people and made-up prices only. It does not name or describe the outside game, and it does not report how the class did.
10. **Outcome codes `FIN1010 3.7` and `2.6`.** From the Objectives line of the Lesson 11 outline. 2.4 (compound interest) is left to the earlier units of the section and 5.3.1 is not taught.

## Figures from the game

11. **Event sizes in level 7.** A company scandal takes 35% off one stock; a market crash takes 25% off the total market fund and 5% off the bond fund. From `EVENTS` in `modules/exchange/constants.js`. A teacher can stage these events. The unit says "the game can stage" them, not that they will happen. The scandal is in level 7 card 5 and l7-q6; the crash appears only in l7-q7.
12. **"Ups and downs": bond fund about 5%, total market fund about 15%, Corner Mart about 25%, Callpoint Support about 45% a year.** From `sigmaBp` in the same file, as the Exchange's Markets tab shows them. The card says these are the starting figures. Used in level 7 card 6 and l7-q8. The constants file marks the stock figures ILLUSTRATIVE.
13. **The three funds.** Level 2 card 4 says the Exchange has a fund of every company in town, a bond fund and one that mixes the two (constants: DAAX, DAAB, DAAG 60/40). No price, rate or fee of a fund is quoted. The 1% fee in l2-q7 is made up.
14. **The Exchange button.** The level 7 `go` opens the building `exchange`, which opens on its Markets tab. A student can read each fund and company there without placing an order; the card says so. The Exchange can be paused by a teacher or closed with the season. I did not click through the building in a browser; I read its code (`modules/exchange/ui/exchange.js`: it opens on the Markets tab and the Buy button is only on each card).

## Written without a number

15. **Real prices, rates or returns of any real investment.** None is used. "Stocks return X% a year", real GIC rates, bond yields, house price changes, the Bank of Canada target and any crash date are not in the unit.
16. **Made-up arithmetic.** All people and amounts in word problems are made up: Amina's $500, Tomas's $800 loan at 5%, Jess's 2% of a $40,000 bakery, a fund with a 1% fee, the four stock years (-30%, +4%, +12%, +34%, average 5%), Priya's units at $120 and $90, Ben's $100 a month at prices $100, $80, $50 and $100. They are arithmetic, not facts.

## Where the game and your slides differ

17. **Your slide 7 compares a savings account with a stock using only your example rates.** The game starts its savings rate at 2.75% and its expected equity growth at 6.3%, and these can change. The unit does not use the game's rates; it uses your example, labelled as one.
18. **Your slides name crypto, gold and real estate; the game has none of them.** Level 2 and 3 teach the ten kinds as ideas; the Exchange has funds and company stocks only.

## Added after the independent review (2026-11-10)

19. Level 2 card 5 says "A GIC is a loan to a bank". That is our wording, not the outline's.
20. Level 7 card 6 now says the Exchange shows "Ups and downs" on the card of most funds and companies: the balanced fund has no such line in the game.
