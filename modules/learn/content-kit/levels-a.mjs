import { level, choice, num, pt, T, tbl, bars, line, stubFig, stub, tax, m, m0, cppFor, eiFor, employerShare, GROSS, NET, DED, CPP, EI, WAGE, SAL, EXEMPT, PREM } from './gen-lib.mjs';

// ---------------------------------------------------------------- Level 1: wages and salary
{
  const week = (h, w = 1300) => h * w;
  const monthly = (weekly) => Math.round((weekly * 52 * 100) / 12);   // dollars a week -> cents a month
  level(1, 'Wages and salary', ['A wage pays you for hours. A salary pays you for the job.', 'You will turn both into one monthly number you can compare.'], [
    'Money from work comes in two main ways. A wage is a set rate for each hour you work. A salary is a set amount for the whole year, paid in equal parts.',
    'With a wage, more hours means more pay. With a salary, your pay stays the same in a busy month. That makes it easy to plan, but extra hours are usually not paid.',
    { text: 'A year is 52 weeks and 12 months, so a month is not four weeks. To turn weekly pay into monthly pay, multiply by 52 and divide by 12.',
      figure: tbl('Weekly pay to monthly pay', ['Weekly pay', 'x 52 / 12 = monthly pay'], [['$156', m(monthly(156))], ['$364', m(monthly(364))], ['$600', m(monthly(600))], ['$1,000', m(monthly(1000))]]) },
    'An hourly wage times your hours is your gross pay. At $13.00 an hour for 12 hours a week, you earn $156.00 each week. Gross means before anything is taken off.',
    'Jobs in the game list a wage and the hours you work each month. The Job Centre shows that pay before deductions. That is your gross pay. Next you will see what is taken off it.',
  ], [
    choice('x', 'Wage or salary', 'Dana is paid $18.00 for each hour she works. What is this kind of pay called?',
      ['A wage', 'Right. A wage is a rate for each hour worked.'],
      [['A salary', 'A salary is a set amount for the year. Dana is paid by the hour, so more hours means more pay.'], ['A bonus', 'A bonus is extra pay for a goal or a good year. Dana\'s $18.00 is her normal pay.'], ['A tax', 'A tax is taken from pay. It is not the pay itself.']],
      'Look for the words "for each hour".', { terms: [WAGE, SAL] }),
    choice('x', 'Extra hours', 'A salaried worker stays late three nights in a busy week. What usually happens to the pay?',
      ['It usually stays the same', 'Yes. A salary is for the job, so extra hours are usually not paid by the hour.'],
      [['It rises for every extra hour', 'That is how a wage works. A salary stays fixed, even when the hours grow.'], ['It drops for the week', 'A salary does not go down because you worked more. It stays steady.'], ['It is paid in cash that day', 'Pay does not change on the day. A salary arrives on the normal pay date.']],
      'A salary pays for the job, not the hours.', { terms: [SAL] }),
    num('x', 'Weekly to monthly', 'You earn $156.00 each week. About how much is that in a month? (weekly pay x 52 / 12)', {
      unit: '$', answer: monthly(156), tol: 5, why: 'A year has 52 weeks, and it has 12 months. Change weeks to a year first, then split the year into 12 parts.',
      working: `$156.00 x 52 = $8,112.00 a year. $8,112.00 / 12 = ${m(monthly(156))} a month.`, hint: 'Multiply by 52 first. Then divide by 12.',
      traps: [{ value: 62400, why: 'That is $156 x 4. A month is a little longer than four weeks, because 52 weeks / 12 months is about 4.33.' }] }),
    num('x', 'Hours times wage', 'You work 12 hours a week at $13.00 an hour. What is your gross pay for one week?', {
      unit: '$', answer: 15600, tol: 0, why: 'Gross pay for an hourly job is your wage times your hours.', working: '$13.00 x 12 hours = $156.00.', hint: 'Wage x hours.', terms: [GROSS] }),
    {
      ...choice('x', 'Highest pay', 'Who has the highest gross pay for a month?',
        ['Noor', 'Right. $15.00 x 120 hours = $1,800.00. That beats Mira at $1,760.00 and Kai at $1,575.00.'],
        [['Kai', 'Kai has the highest wage, $17.50. But 90 hours is the fewest, so he makes $1,575.00.'], ['Mira', 'Mira makes $16.00 x 110 = $1,760.00. That is close, but Noor makes $1,800.00.'], ['They are all equal', 'Multiply each wage by its hours. The three totals are different.']],
        'Multiply wage x hours for each person.'),
      figure: tbl('Three part-time jobs', ['Person', 'Wage', 'Hours a month'], [['Kai', '$17.50 an hour', '90'], ['Mira', '$16.00 an hour', '110'], ['Noor', '$15.00 an hour', '120']]),
    },
    choice('x', 'What a salary is', 'Which sentence about a salary is true?',
      ['It is a fixed amount for the year', 'Yes. It is split into equal pay cheques through the year.'],
      [['It is paid only for hours you clock in', 'That describes a wage. A salary does not change with the hours you clock.'], ['It is paid once a year', 'A salary is the yearly total, but it is paid in parts, such as monthly.'], ['It always grows with more hours', 'The point of a salary is that it does not change with the hours.']],
      'Fixed for the year, paid in parts.', { terms: [SAL] }),
    num('x', 'Salary to month', 'A job pays a salary of $42,000 a year, paid monthly. What is the gross pay each month?', {
      unit: '$', answer: 350000, tol: 0, why: 'A salary is a yearly number. A monthly pay is one twelfth of it.', working: '$42,000 / 12 = $3,500.00 a month.', hint: 'Split the year into 12 pay periods.',
      traps: [{ value: 80769, why: 'That is $42,000 / 52, a weekly amount. For a month, divide by 12.' }] }),
    pt('x', 'Pick the bar', 'Tap the bar that shows your gross pay for a week of 20 hours at $13.00 an hour.',
      bars('Weekly gross pay at $13.00 an hour', '$', [['6 h', 7800], ['12 h', 15600], ['20 h', 26000], ['28 h', 36400]]), 2, '20 hours x $13.00 = $260.00, the third bar.', 'Work out 20 x 13 first.'),
    choice('x', 'Gross means', 'What does "gross pay" mean?',
      ['Pay before anything is taken off', 'Yes. Gross pay is the headline number, before deductions.'],
      [['Pay after everything is taken off', 'That is net pay. Gross comes before the deductions.'], ['Pay for overtime only', 'Gross is all of your pay, not just one kind.'], ['A bonus at year end', 'A bonus can be part of gross pay, but gross pay means all pay before deductions.']],
      'Gross comes first. Net comes after.', { terms: [GROSS, NET] }),
  ]);
}

// ---------------------------------------------------------------- Level 2: gross pay is the headline
{
  const s676 = 67600, s2600 = 260000;
  level(2, 'Gross pay is the headline', ['Gross pay is the number on the job offer.', 'It is not the number you get to spend.'], [
    'Gross pay is your pay before anything is taken off. It is the number in a job ad and the number your boss agrees to. Net pay is what is left after deductions.',
    'Some money is taken off before it reaches you. Your employer sends it to the government for you. Each amount is called a deduction. There are four main ones: CPP, EI, federal tax and Alberta tax.',
    'Full time at the general minimum wage is $15.00 an hour for 40 hours a week. That is $600.00 a week, and $2,600.00 a month. That $2,600.00 is gross pay.',
    'A student job is often about 12 hours a week. In a month that is about 52 hours (12 x 52 / 12). At $13.00 an hour, the gross pay is $676.00.',
    'Plan your spending with net pay, not gross pay. A budget built on gross pay will be short every month. In the game, your chequing balance grows by your net pay.',
  ], [
    choice('x', 'Gross or net', 'A job ad says "$17.50 an hour". Is that gross pay or net pay?',
      ['Gross pay', 'Yes. The ad names the pay before any deductions.'],
      [['Net pay', 'Net pay is what lands after deductions. An ad cannot know yours.'], ['Both, they are the same', 'They are different. The gap between them is the deductions.'], ['Neither, it is a bonus', 'An hourly wage is normal pay, not a bonus.']],
      'Ads show the number before anything comes off.', { terms: [GROSS, NET] }),
    choice('x', 'Budget base', 'Which number should you use to plan what you can spend each month?',
      ['Your net pay', 'Yes. Net pay is the money that actually lands in your account.'],
      [['Your gross pay', 'Gross includes money that never reaches you. A budget on gross runs short.'], ['Your wage rate', 'The rate alone does not show how many hours or what comes off.'], ['Your boss\'s total payroll', 'That is the whole company\'s cost. It says nothing about your account.']],
      'Spend what lands, not what was promised.', { terms: [NET] }),
    num('x', 'Month of hours', 'You work 12 hours each week. About how many hours is that in a month? (hours a week x 52 / 12)', {
      unit: 'hours', answer: 52, tol: 0.5, why: 'There are 52 weeks and 12 months, so 12 hours a week adds up to the same number of hours in a month.', working: '12 x 52 = 624 hours a year. 624 / 12 = 52 hours a month.', hint: 'Yearly hours first, then split into 12.' }),
    num('x', 'Student gross', 'You earn $13.00 an hour and work 52 hours in a month. What is your gross pay for the month?', {
      unit: '$', answer: s676, tol: 0, why: 'Wage x hours gives gross pay.', working: '$13.00 x 52 hours = $676.00.', hint: 'Wage x hours.', terms: [GROSS] }),
    num('x', 'Full-time gross', 'Full time at the general minimum wage is $15.00 an hour for 40 hours a week. What is the gross pay for a month? (use 52 weeks / 12 months)', {
      unit: '$', answer: s2600, tol: 0, why: 'First find the week, then the year, then one month.', working: '$15.00 x 40 = $600.00 a week. $600.00 x 52 / 12 = $2,600.00 a month.', hint: 'Week, then x 52, then / 12.',
      traps: [{ value: 240000, why: 'That is $600 x 4. A month has about 4.33 weeks, not 4.' }] }),
    choice('x', 'Who sends it', 'For most jobs, who sends your CPP, EI and income tax to the government?',
      ['Your employer, from your pay', 'Yes. The employer takes it off before you are paid and sends it in.'],
      [['You, at your bank, each month', 'You do not pay these by hand. They come off before the pay reaches you.'], ['Your bank, on its own', 'A bank does not know your tax. The employer does the work.'], ['Your school, at report time', 'A school has no part in it. This is between the employer and the government.']],
      'It comes off before you see it.', { terms: [DED] }),
    {
      ...choice('x', 'Best offer', 'Which offer has the highest gross pay per month?',
        ['Offer C: $600.00 a week', 'Right. $600.00 x 52 / 12 = $2,600.00 a month, the most of the three.'],
        [['Offer A: $2,400.00 a month', 'That is $2,400.00, which is less than $2,600.00.'], ['Offer B: $27,000.00 a year', '$27,000 / 12 = $2,250.00 a month, the lowest.']],
        'Put each offer on a monthly basis first.'),
      figure: tbl('Three ways to say pay', ['Offer', 'Pay as written'], [['Offer A', '$2,400.00 a month'], ['Offer B', '$27,000.00 a year'], ['Offer C', '$600.00 a week']]),
    },
    pt('x', 'Pick the bar', 'Tap the bar that shows the gross pay for 28 hours a week at $13.00 an hour.',
      bars('Gross pay a month at $13.00 an hour', '$', [['12 h a week', 67600], ['20 h a week', 112667], ['28 h a week', 157733], ['40 h a week', 225333]]), 2,
      '28 hours x $13.00 x 52 / 12 is $1,577.33 a month, the third bar.', 'Find the bar labeled 28 h a week.'),
    choice('x', 'A deduction', 'Which one of these is a deduction?',
      ['CPP taken off your pay', 'Yes. CPP is taken off your gross pay before you are paid.'],
      [['Your hourly wage', 'The wage is what you earn. A deduction is what comes off.'], ['The hours you worked', 'Hours are part of how gross pay is worked out. They are not taken off.'], ['A raise from your boss', 'A raise adds to your pay. A deduction subtracts.']],
      'A deduction is taken away from your pay.', { terms: [DED, CPP] }),
  ]);
}

// ---------------------------------------------------------------- Level 3: CPP
{
  const g = (c) => stub(c);
  const cppRows = [50000, 100000, 150000, 200000, 250000, 300000].map((c) => [`$${c / 100}`, cppFor(c, 0)]);
  const firstOver = cppRows.findIndex((r) => r[1] > 10000);
  level(3, 'What comes off: CPP', ['CPP is 5.95% of your pay above a small monthly amount.', 'It is a pension you pay into, not money that disappears.'], [
    'CPP is the Canada Pension Plan. You pay in while you work. When you are older, it pays you a monthly pension. Your employer pays in too.',
    'The CPP rate is 5.95%. It does not apply to your first $3,500 of pay each year. In the game, that is $291.66 of each monthly pay. CPP is charged on the rest.',
    { text: 'For a gross pay of $2,600.00: take off $291.66 first. That leaves $2,308.34. Then take 5.95% of it. CPP is $137.35.',
      figure: tbl('CPP on $2,600.00 gross', ['Step', 'Amount'], [['Gross pay', '$2,600.00'], ['Minus the monthly exemption', '- $291.66'], ['Pay that CPP is charged on', '$2,308.34'], ['5.95% of that', m(g(260000).cpp)]]) },
    'Your employer pays the same CPP amount on top of yours. It does not come out of your pay. There is a yearly maximum, $4,230.45 for 2026. When you reach it, CPP stops until January.',
    'Look for the line "Canada Pension Plan (CPP)" on your pay stub in the Job Centre. You will find where it sits in the last levels of this unit.',
  ], [
    choice('x', 'What CPP is', 'What is the Canada Pension Plan (CPP)?',
      ['A pension plan you pay into while you work', 'Yes. You pay in now, and it pays you a pension when you are older.'],
      [['A tax that pays for schools and roads', 'Income tax does that. CPP is set aside for your own retirement.'], ['Insurance if you lose your job', 'That is EI, Employment Insurance.'], ['A savings account at your bank', 'A bank account is yours to open and spend. CPP is a government plan with set rules.']],
      'Think of a pension you build up.', { terms: [CPP] }),
    num('x', 'CPP rate', 'What percent rate is the CPP charged at?', { unit: '%', answer: 5.95, tol: 0.005, why: 'The employee CPP rate for 2026 is 5.95%.', working: 'The rate is 5.95%.', hint: 'A little under 6%.', terms: [CPP] }),
    num('x', 'Student CPP', 'Your gross pay is $676.00 for the month. CPP is 5.95% of the pay above $291.66. How much CPP comes off?', {
      unit: '$', answer: g(67600).cpp, tol: 1, why: 'CPP skips the first $291.66 of each monthly pay. It is charged only on the rest.',
      working: '$676.00 - $291.66 = $384.34. $384.34 x 5.95% = $22.87.', hint: 'Subtract $291.66 first.', terms: [EXEMPT],
      traps: [{ value: Math.round(67600 * 0.0595), why: 'That is 5.95% of the whole $676. The first $291.66 of each month is not charged.' }], check: { stub: 67600, field: 'cpp' } }),
    num('x', 'Full-time CPP', 'Your gross pay is $2,600.00 for the month. How much CPP comes off? (5.95% of the pay above $291.66)', {
      unit: '$', answer: g(260000).cpp, tol: 1, why: 'Take off the monthly exemption, then apply 5.95%.', working: '$2,600.00 - $291.66 = $2,308.34. $2,308.34 x 5.95% = $137.35.', hint: 'Subtract $291.66 first.',
      traps: [{ value: Math.round(260000 * 0.0595), why: 'That is 5.95% of the whole $2,600. CPP skips the first $291.66 of the month.' }], check: { stub: 260000, field: 'cpp' } }),
    num('x', 'Employer match', 'Your CPP this month is $137.35. How much does your employer pay into CPP for you, on top of your pay?', {
      unit: '$', answer: employerShare(g(260000)).cpp, tol: 0, why: 'The employer pays the same amount as you do. It is not taken from your pay.', working: 'The employer matches yours: $137.35.', hint: 'The employer matches you.', check: { stub: 260000, field: 'employerCpp' } }),
    choice('x', 'Where CPP goes', 'Where does the CPP taken from your pay go?',
      ['Into your own future pension', 'Yes. It builds a pension that is paid to you when you are older.'],
      [['It disappears and is never paid back', 'CPP is not lost. It is the base for the pension you collect later.'], ['Into your chequing account', 'It would not be a deduction if it came back to chequing now.'], ['To your employer as a fee', 'The employer does not keep it. The money goes to the CPP.']],
      'It is saved for you, by the government.', { terms: [CPP] }),
    {
      ...choice('x', 'Read the stub', 'The stub shows gross pay of $1,577.00. What is the CPP line?',
        [m(g(157700).cpp), 'Yes. ($1,577.00 - $291.66) x 5.95% is $76.48.'],
        [[m(g(157700).ei), 'That is the EI line. CPP is the line above it.'], [m(Math.round(157700 * 0.0595)), 'That is 5.95% of the whole gross. CPP skips the first $291.66 of the month.'], [m(g(157700).net), 'That is the net pay, the last line, not a deduction.']],
        'Find the line called Canada Pension Plan.'),
      figure: stubFig('Pay stub, gross $1,577.00', 157700),
    },
    pt('x', 'Find the point', 'Tap the first point where the CPP on a monthly pay is more than $100.00.',
      line('CPP by monthly gross pay', '$', cppRows), firstOver, `At $2,000 gross, CPP is ${m(cppFor(200000, 0))}. At $1,500 it is ${m(cppFor(150000, 0))}, which is still under $100.00.`, 'Read the value of each point.'),
    choice('x', 'The yearly limit', 'In 2026, what happens when your CPP for the year reaches the maximum?',
      ['CPP stops coming off until January', 'Yes. The maximum is $4,230.45 for 2026. After that, no more CPP comes off that year.'],
      [['You pay double for the rest of the year', 'Nothing doubles. You stop paying once you hit the maximum.'], ['Your pension is cancelled', 'Reaching the maximum is a good thing. It does not cancel anything.'], ['Your employer pays your share', 'The employer\'s own share also stops at the maximum. Neither of you pays more.']],
      'There is a cap on what one person pays in a year.'),
  ]);
}

// ---------------------------------------------------------------- Level 4: EI
{
  const g = (c) => stub(c);
  const pts = [50000, 100000, 150000, 200000, 250000, 300000].map((c) => [`$${c / 100}`, eiFor(c, 0)]);
  level(4, 'What comes off: EI', ['EI is 1.63% of every dollar you earn, up to a yearly limit.', 'It is insurance for losing a job through no fault of your own.'], [
    'EI is Employment Insurance. It pays you for a while if you lose your job through no fault of your own, such as a layoff. Quitting usually does not qualify.',
    'The EI rate is 1.63%. That is $1.63 for every $100 you earn. Unlike CPP, there is no exemption. EI is charged on all of your gross pay.',
    { text: 'On $2,600.00 gross, EI is 1.63% of $2,600.00, which is $42.38. On a student pay of $676.00 it is $11.02.',
      figure: tbl('EI at 1.63%', ['Gross pay', 'EI'], [['$676.00', m(g(67600).ei)], ['$1,577.00', m(g(157700).ei)], ['$2,600.00', m(g(260000).ei)], ['$4,333.00', m(g(433300).ei)]]) },
    'There is a yearly limit. You pay EI only on the first $68,900 you earn in 2026, so the most you can pay is $1,123.07. Your employer pays 1.4 times your amount on top.',
    'You pay EI whether or not you ever use it, like any insurance. It is the second deduction on your pay stub, under CPP.',
  ], [
    choice('x', 'What EI is', 'What is Employment Insurance (EI)?',
      ['Insurance for losing a job through no fault of yours', 'Yes. It pays benefits for a while, for example after a layoff.'],
      [['A pension for when you are older', 'That is CPP. EI is for job loss, not for retirement.'], ['A savings plan for a first car', 'EI is not a savings account. It is a government insurance plan.'], ['A loan for students', 'EI is not a loan. You do not pay it back.']],
      'Insurance against job loss.', { terms: [EI] }),
    num('x', 'EI rate', 'What percent of your gross pay is the EI premium?', { unit: '%', answer: 1.63, tol: 0.005, why: 'The 2026 employee EI rate is 1.63%, which is $1.63 for each $100.', working: 'The rate is 1.63%.', hint: 'It is about one and a half percent.', terms: [EI, PREM] }),
    num('x', 'Student EI', 'Your gross pay is $676.00 for the month. How much EI comes off? (1.63% of all your gross pay)', {
      unit: '$', answer: g(67600).ei, tol: 1, why: 'EI has no exemption. It is charged on all of your gross pay.', working: '$676.00 x 1.63% = $11.02.', hint: 'Use the whole $676.00.',
      traps: [{ value: Math.round((67600 - 29166) * 0.0163), why: 'You took off $291.66 first, as CPP does. EI has no exemption: use the whole gross pay.' }], check: { stub: 67600, field: 'ei' } }),
    num('x', 'Full-time EI', 'Your gross pay is $2,600.00 for the month. How much EI comes off?', {
      unit: '$', answer: g(260000).ei, tol: 1, why: 'Take 1.63% of all of the gross pay.', working: '$2,600.00 x 1.63% = $42.38.', hint: '1.63% of $2,600.00.', check: { stub: 260000, field: 'ei' } }),
    num('x', 'Bigger pay EI', 'Your gross pay is $4,333.00 for the month. How much EI comes off?', {
      unit: '$', answer: g(433300).ei, tol: 1, why: 'Same rule at any pay under the yearly limit: 1.63% of gross.', working: '$4,333.00 x 1.63% = $70.63.', hint: '1.63% of $4,333.00.', check: { stub: 433300, field: 'ei' } }),
    num('x', 'Employer EI', 'Your EI this month is $42.38. Your employer pays 1.4 times your EI on top. How much does the employer pay?', {
      unit: '$', answer: employerShare(g(260000)).ei, tol: 1, why: 'The employer premium is 1.4 times the employee premium.', working: '$42.38 x 1.4 = $59.33.', hint: 'Multiply by 1.4.', check: { stub: 260000, field: 'employerEi' } }),
    choice('x', 'Laid off or quit', 'Jo\'s shop closed, and Jo was laid off. Sam quit to travel. Who is more likely to be able to get EI?',
      ['Jo, because of the layoff', 'Yes. EI is for job loss that is not your fault. Quitting usually does not qualify.'],
      [['Sam, because Sam chose freely', 'It is the other way around. Quitting without a good reason usually does not qualify.'], ['Both, the same', 'The reason you left matters. A layoff and a quit are treated differently.'], ['Neither, EI is only for adults over 65', 'That is a pension idea. EI is for people of working age who lose a job.']],
      'Was losing the job the worker\'s choice?', { terms: [EI] }),
    pt('x', 'Find the point', 'Tap the point for a gross pay of $1,500.00 a month.',
      line('EI by monthly gross pay', '$', pts), 2, `At $1,500 gross, EI is ${m(eiFor(150000, 0))}, the third point.`, 'The labels show the gross pay.'),
    choice('x', 'CPP and EI', 'Which sentence compares CPP and EI correctly?',
      ['CPP skips a first part of pay; EI does not', 'Yes. CPP has an exemption. EI is charged on all of the gross pay.'],
      [['EI skips the first $3,500; CPP does not', 'It is the other way around. CPP has the $3,500 exemption.'], ['Both skip the first $3,500', 'Only CPP does. EI is charged from the first dollar.'], ['Neither has a yearly maximum', 'Both have a yearly maximum. After it, the deduction stops for the year.']],
      'Only one of them has an exemption.', { terms: [EXEMPT] }),
  ]);
}
