// ventures: products, the classmate storefront and the monthly tick.
import { money, ok } from '../../lib/kernel.js';
import {
  MAX_PRODUCTS, PRICE_CAP_X, productType, SPOILAGE_BP, REP_START_BP, REP_MIN_BP, REP_MAX_BP, REP_STOCKOUT_BP, REP_DELIVERED_BP, INCUMBENT_REF_BP, RENT_FREEZE_MONTHS, GST_BP,
} from './constants.js';
import { unitCost, curve, share, allocate, incumbentPrice, noiseBp, gstOf } from './demand.js';
import { LIVE, inList, q1, qa, company, products, treasuryOf, chequing, settingOf, costOf, changed, needWorld, rentOf, capsOf, townSize, secretOf, bump, note, takeUnits, mustBe, gstOn } from './reads.js';
import { writeStatement, gstOnProduction, finance } from './finance.js';
import { memberOf, announce } from './founding.js';

// ---- products ----
export function setProduct(k, user, id, key, price, quantity) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c, m } = memberOf(k, user, id, ['approved', 'active']);
    mustBe(m.status === 'accepted', 403, 'Only a founder can change products');
    const t = productType(key);
    mustBe(t && t.sector === c.sector, 400, `Pick one of the ${c.sector} products`);
    const cost = costOf(k, w, t), cap = cost * PRICE_CAP_X;
    mustBe(price >= 1 && price <= cap, 400, `The price must be between $0.01 and ${money(cap)} (${PRICE_CAP_X} x the unit cost of ${money(cost)}): no price gouging`);
    const have = q1(k, 'SELECT * FROM ventures_products WHERE company_id = ? AND type_key = ?', id, key);
    if (!have?.active) mustBe(products(k, id).length < MAX_PRODUCTS, 409, `A company sells at most ${MAX_PRODUCTS} products. Drop one first.`);
    k.db.prepare(`INSERT INTO ventures_products (company_id, type_key, price_cents, quantity, created_month) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (company_id, type_key) DO UPDATE SET price_cents = excluded.price_cents, quantity = excluded.quantity, active = 1`).run(id, key, price, quantity, w.month);
    k.audit('product', { id, key, price, quantity }, `player:${user.id}`);
    changed(k, tx, c.class_id);
    return { ok: true, unit_cost_cents: cost, monthly_cost_cents: cost * quantity };
  });
}
export function dropProduct(k, user, id, key) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c, m } = memberOf(k, user, id, ['approved', 'active']);
    mustBe(m.status === 'accepted', 403, 'Only a founder can change products');
    const p = q1(k, 'SELECT * FROM ventures_products WHERE company_id = ? AND type_key = ? AND active = 1', id, key);
    mustBe(p, 404, 'You do not sell that');
    if (p.inventory_units > 0) bump(k, id, p.id, w.month, { spoiled_units: p.inventory_units, spoilage_cents: takeUnits(k, p, p.inventory_units) });   // written off
    k.db.prepare('UPDATE ventures_products SET active = 0, quantity = 0 WHERE id = ?').run(p.id);
    tx.onCommit(() => announce(k, w, id));
    changed(k, tx, c.class_id);
    return { ok: true };
  });
}

// ---- the storefront: a classmate buys one unit (chequing or card -> treasury) and gets a cosmetic item (Outfitters) or a receipt line ----
// What a buyer has spent on Venture Row this world month: at one company, and in all.
export const spentBy = (k, pid, w, companyId) => q1(k, 'SELECT COALESCE(SUM(cents), 0) AS month, COALESCE(SUM(CASE WHEN company_id = ? THEN cents END), 0) AS company FROM ventures_purchases WHERE player_id = ? AND world_id = ? AND month = ?', companyId ?? -1, pid, w.id, w.month);
export const limitOf = (k, pid, wid) => q1(k, 'SELECT limit_cents FROM ventures_limits WHERE player_id = ? AND world_id = ?', pid, wid)?.limit_cents;
export function payFrom(k, user, w, source, cents) {
  if (source === 'card') {
    const account = k.ledger.accountId('player', user.id, 'card');
    mustBe(account, 400, 'You do not have a credit card yet');
    const limit = limitOf(k, user.id, w.id);
    mustBe(limit !== undefined, 400, 'Card payments are unavailable: your card limit for this season is not known yet.');
    const available = Math.max(0, k.ledger.balance(account) + limit);
    mustBe(available >= cents, 400, `Not enough room on your card: you have ${money(available)} available`);
    return account;
  }
  mustBe(source === 'chequing', 400, 'Pay from chequing or card');
  const account = chequing(k, user.id);
  mustBe(k.ledger.balance(account) >= cents, 400, `Not enough in chequing: you have ${money(k.ledger.balance(account))}`);
  return account;
}
export function buy(k, user, productId, source) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const p = q1(k, 'SELECT * FROM ventures_products WHERE id = ? AND active = 1', productId);
    const c = p && company(k, p.company_id);
    mustBe(c && c.world_id === w.id && c.status === 'active', 404, 'That product is not for sale');
    mustBe(!q1(k, "SELECT 1 FROM ventures_members WHERE company_id = ? AND player_id = ? AND status = 'accepted'", c.id, user.id) && !q1(k, 'SELECT 1 FROM ventures_shares WHERE company_id = ? AND player_id = ? AND units_micro > 0', c.id, user.id), 409, 'You cannot buy from your own company');
    mustBe(p.inventory_units >= 1, 409, 'Sold out this month: come back after the next production run');
    const t = productType(p.type_key), cost = costOf(k, w, t);
    mustBe(p.price_cents <= cost * PRICE_CAP_X, 409, 'That price is over the price-gouging limit; the company has to lower it first');
    const caps = capsOf(k), spent = spentBy(k, user.id, w, c.id);
    mustBe(spent.company + p.price_cents <= caps.company, 409, `You can spend at most ${money(caps.company)} a world month at one company (${money(Math.max(0, caps.company - spent.company))} left at ${c.name})`);
    mustBe(spent.month + p.price_cents <= caps.month, 409, `You can spend at most ${money(caps.month)} a world month on Venture Row (${money(Math.max(0, caps.month - spent.month))} left)`);
    const gst = gstOn(c, w.month) ? gstOf(p.price_cents, GST_BP) : 0, paid = p.price_cents + gst;   // 4b: a GST registrant charges 5% on top (the caps count the price)
    const from = payFrom(k, user, w, source, paid);
    const txn = k.ledger.post({ kind: 'store_sale', actor: `player:${user.id}`, meta: { company: c.id, product: p.id, month: w.month, from: source, gst },
      legs: [{ account: from, cents: -paid, memo: `${t.name} from ${c.name}${gst ? ' (incl. GST)' : ''}` }, { account: treasuryOf(k, c.id), cents: paid, memo: `Sold to a classmate: ${t.name} (month ${w.month})${gst ? `, incl. ${money(gst)} GST` : ''}` }] });
    bump(k, c.id, p.id, w.month, { store_units: 1, store_cents: p.price_cents, cogs_cents: takeUnits(k, p, 1) });
    if (gst) bump(k, c.id, 0, w.month, { gst_collected_cents: gst });
    let item = null;
    if (k.modules.has('outfitters')) {
      try { item = k.modules.call('outfitters', 'grantItem', { playerId: user.id, worldId: w.id, sector: c.sector }); } catch (e) { if (!(e instanceof k.HttpError)) throw e; }
    }
    k.db.prepare('INSERT INTO ventures_purchases (world_id, player_id, company_id, product_id, month, cents, source, txn_id, item_id, item_name, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(w.id, user.id, c.id, p.id, w.month, p.price_cents, source, txn, item?.granted ? item.itemId : null, item?.granted ? item.name : null, k.clock.now());
    tx.onCommit(() => announce(k, w, c.id));
    changed(k, tx, user.class_id);
    if (c.class_id !== user.class_id) changed(k, tx, c.class_id);
    return { ok: true, cents: paid, item: item?.granted ? item.name : null, receipt: `${t.name} from ${c.name}, ${money(paid)}${gst ? ` (${money(gst)} GST)` : ''}` };
  });
}


// ---- the tick ----
export const hadRun = (k, productId) => !!q1(k, 'SELECT 1 FROM ventures_flows WHERE product_id = ? AND produced_units > 0 LIMIT 1', productId);
// Town demand for last month, per product type (module-wide, pure): each active product of an active company against the others and the town's
// own shop. `wanted`: what each would have sold with unlimited stock (for its numbers and its reputation); `sold`: what it does sell, where
// only products with stock compete, each is capped at its stock, and demand it cannot meet goes to the others (mostly to the town shop).
export function townDemand(k, w, from, n, index) {
  const secret = secretOf(k, w.id), wanted = new Map(), sold = new Map();
  const list = qa(k, "SELECT p.*, c.rep_bp, c.sector FROM ventures_products p JOIN ventures_companies c ON c.id = p.company_id WHERE c.world_id = ? AND c.status = 'active' AND p.active = 1 ORDER BY p.id", w.id);
  for (const key of new Set(list.map((p) => p.type_key))) {
    const t = productType(key), s = settingOf(k, w.id, t.sector), cv = curve(t, n, s.a_bp, s.b_bp, index);
    const shop = { price_cents: incumbentPrice(cv, INCUMBENT_REF_BP), rep_bp: REP_START_BP, cap: Infinity };
    const mine = list.filter((p) => p.type_key === key).map((p) => ({ id: p.id, price_cents: p.price_cents, rep_bp: p.rep_bp, noise_bp: noiseBp(secret, from, p.id), cap: p.inventory_units, ran: p.inventory_units > 0 || hadRun(k, p.id) }));
    const counted = mine.filter((p) => p.ran);
    share(cv, [...counted, shop]).slice(0, -1).forEach((x, i) => wanted.set(counted[i].id, Math.floor(x)));
    const stocked = mine.filter((p) => p.cap > 0);
    allocate(cv, [...stocked, shop]).slice(0, -1).forEach((x, i) => sold.set(stocked[i].id, Math.min(stocked[i].cap, Math.floor(x + 1e-9))));
  }
  return { wanted, sold };
}

export function tick(k, { month }) {
  const w = k.world.current(), from = month - 1, n = townSize(k), index = k.world.priceIndex(w.id), rent = rentOf(k, w);
  const live = qa(k, `SELECT * FROM ventures_companies WHERE world_id = ? AND status IN ${inList(LIVE)} ORDER BY id`, w.id);
  const { wanted, sold } = townDemand(k, w, from, n, index);
  k.forEachPlayer(live, (c) => {                                    // each company in its own savepoint (named by its registrant)
    // 1. what the town buys of last month's demand. A stockout (wanted more than it had) costs reputation, but only for a product that had
    // at least one paid production run: a product nobody has made yet is not letting anyone down.
    if (c.status === 'active') {
      let unmet = false, any = false;
      for (const p of products(k, c.id)) {
        if (!wanted.has(p.id) && !sold.has(p.id)) continue;
        const want = wanted.get(p.id) ?? 0, units = sold.get(p.id) ?? 0;
        if (want > p.inventory_units) unmet = true;
        if (units > 0) any = true;
        const cents = units * p.price_cents;
        if (cents > 0) k.ledger.post({ kind: 'npc_sale', actor: 'system', meta: { company: c.id, product: p.id, month: from, units },
          legs: [{ account: k.ledger.system('mint'), cents: -cents, memo: `Town sales: ${productType(p.type_key).name}` }, { account: treasuryOf(k, c.id), cents, memo: `Town sales: ${units} x ${productType(p.type_key).name} (month ${from})` }] });
        bump(k, c.id, p.id, from, { demand_units: want, npc_units: units, npc_cents: cents, cogs_cents: units ? takeUnits(k, p, units) : 0 });
      }
      const rep = Math.min(REP_MAX_BP, Math.max(REP_MIN_BP, c.rep_bp + (unmet ? REP_STOCKOUT_BP : any ? REP_DELIVERED_BP : 0)));
      if (rep !== c.rep_bp) k.db.prepare('UPDATE ventures_companies SET rep_bp = ? WHERE id = ?').run(rep, c.id);
    }
    // 2. spoilage of what is left
    const spoil = SPOILAGE_BP[c.sector] ?? 0;
    for (const p of products(k, c.id, true)) {
      const units = p.inventory_units > 0 ? Math.floor((p.inventory_units * spoil) / 10000) : 0;
      if (units > 0) bump(k, c.id, p.id, from, { spoiled_units: units, spoilage_cents: takeUnits(k, p, units) });
    }
    finance(k, c, from, month);   // 4b: GST on town sales, the loan payment, GST returns and income tax (all on month `from`'s books)
    // 3. last month's statements (a company approved in the month just ended has books from then on)
    if (c.approved_month !== null && c.approved_month <= from) writeStatement(k, c, from);
    // 4. this month's rent, then production, paid from the treasury now. Rent the treasury cannot pay is missed (two months in a row: frozen);
    // a production run it cannot pay is skipped.
    let status = c.status;
    if (status === 'active') {
      const acct = treasuryOf(k, c.id);
      if (rent > 0 && k.ledger.balance(acct) >= rent) {
        k.ledger.post({ kind: 'rent', actor: 'system', meta: { company: c.id, month }, legs: [{ account: acct, cents: -rent, memo: `Storefront rent (month ${month})` }, { account: k.ledger.system('sink'), cents: rent, memo: 'Storefront rent' }] });
        bump(k, c.id, 0, month, { rent_cents: rent });
        if (c.rent_missed) k.db.prepare('UPDATE ventures_companies SET rent_missed = 0 WHERE id = ?').run(c.id);
      } else if (rent > 0) {
        const missed = c.rent_missed + 1;
        k.db.prepare('UPDATE ventures_companies SET rent_missed = ? WHERE id = ?').run(missed, c.id);
        if (missed >= RENT_FREEZE_MONTHS) {
          status = 'frozen';
          k.db.prepare("UPDATE ventures_companies SET status = 'frozen', note = ? WHERE id = ?").run(`Frozen: ${missed} months of rent unpaid. Your teacher can unfreeze it once the treasury can pay.`, c.id);
        }
        note(k, c.id, 0, month, `Rent of ${money(rent)} unpaid: the treasury had ${money(k.ledger.balance(acct))}${status === 'frozen' ? '. The company is frozen.' : ''}`);
      }
    }
    if (status === 'active') {
      for (const p of products(k, c.id)) {
        if (p.quantity <= 0) continue;
        const t = productType(p.type_key), cost = p.quantity * unitCost(t, index), acct = treasuryOf(k, c.id);
        if (k.ledger.balance(acct) < cost) { note(k, c.id, p.id, month, `Production skipped: the run costs ${money(cost)} and the treasury had ${money(k.ledger.balance(acct))}`); continue; }
        k.ledger.post({ kind: 'production', actor: 'system', meta: { company: c.id, product: p.id, month, units: p.quantity },
          legs: [{ account: acct, cents: -cost, memo: `Production: ${p.quantity} x ${t.name} (month ${month})` }, { account: k.ledger.system('sink'), cents: cost, memo: `Materials and time: ${t.name}` }] });
        k.db.prepare('UPDATE ventures_products SET inventory_units = inventory_units + ?, inventory_cost_cents = inventory_cost_cents + ? WHERE id = ?').run(p.quantity, cost, p.id);
        bump(k, c.id, p.id, month, { produced_units: p.quantity, production_cents: cost });
      }
      gstOnProduction(k, c, month);   // 4b
    } else if (c.status === 'frozen') note(k, c.id, 0, month, 'Frozen by your teacher: no production or sales this month');
    announce(k, w, c.id);
  }, (c) => c.founder_id);
}
