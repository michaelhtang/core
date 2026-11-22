# core (formerly vDAA, "virtual Dr. Anne Anderson")

A persistent virtual economy for a high-school FinTech course. Students are pseudonyms with a chequing account; the
teacher runs the world clock. Phases 0 to 3 are built (see the status column in `PLAN.md` section 10 and `git tag`):

- **Phase 0, core** (`v0-core`, `v1-architecture`): the double-entry ledger, accounts, PIN logins, teacher console, world clock, seasons, module registry and a bot simulator.
- **Phase 1, Payday Town** (`v2-payday-town`): jobs with Alberta payroll, bills, savings (HISA, GICs), net worth.
- **Phase 2, credit and housing** (`v3-credit`, `v4-housing`): the Bank of DAA policy rate, credit score and card, rent or buy, mortgages and renewals, insurance and town events.
- **Phase 1b, Outfitters** (`v5-outfitters`), built after credit and housing: the cosmetic wardrobe.
- **Phase 3** (`v6-leaderboards`, `v7-exchange`, `v8-rrsp`): leaderboards and Wolf ranks, the Exchange (securities, trading, TFSA, dividends, news) and the RRSP.
- `v9-hardening`: the whole-system review fixes (`docs/system-review.md`).

Phase 4 (Ventures) onward has not been started. See `PLAN.md` for where it is going.

Zero npm dependencies. Node 24+ (`node:sqlite`, `node:http`, `node:test`).

## Run

```sh
npm start                  # http://127.0.0.1:3020   (PORT, DATA_DIR to change; data lives in ./data/)
npm test                   # node --test "test/*.test.js"
npm run sim                # node scripts/sim.mjs [--bots=300] [--classes=10] [--months=12]
```

Scripts not wired to npm (run with `node`; `scripts/` also holds the backup tools, see Backup and restore):

```sh
node scripts/sim.mjs --months=60        # the economy balance run behind the Wolf-rank tiers and the Phase 2/3 targets (docs/leaderboards.md)
node scripts/perf.mjs                   # times the ledger hot paths on a temp 60k-transaction database; name=ms arguments are ceilings (exit 1 if exceeded)
VDAA_DEV=1 npm start                    # in one terminal, then:
node scripts/demo-seed.mjs [baseUrl]    # seeds a local server with a demo teacher, one class and 6 students (credentials go to data/demo-credentials.txt)
```

First run: open `/teach`, create the teacher account (username + passphrase), make a class, generate N students, print the
PIN cards. Students open `/` and sign in with the username and 6-digit PIN on their card. First-run setup is **refused unless
`VDAA_SETUP_TOKEN` is set** (the setup form then asks for it), so a stranger can never claim the world teacher; wrong tokens are
throttled like logins and compared in constant time. For local play only, start with `VDAA_DEV=1 npm start` to allow setup without a
token (it also re-reads `public/` on every request; never set it on the server). `scripts/demo-seed.mjs` needs that mode.

Behind Cloudflare and nginx: pass `Host` (`proxy_set_header Host $host`), `X-Forwarded-Proto` and `CF-Connecting-IP`, and turn
buffering off for `/api/stream` (the server also sends `X-Accel-Buffering: no`). Forwarded headers are believed only when the
TCP peer is a trusted proxy: `TRUSTED_PROXIES` (comma-separated, default `127.0.0.1,::1`); anyone else is keyed by socket
address. Let nginx accept connections only from Cloudflare (or use its real-IP module) so `CF-Connecting-IP` cannot be forged.
If the public Host differs, set `PUBLIC_ORIGIN` (for example `https://vdaa.michaelhtang.com`) so same-origin POST checks pass.

## The rule: money only moves through `lib/ledger.js`

Every cent is an INTEGER in the double-entry ledger. `ledger.post({ kind, actor, legs })` and `ledger.transfer(...)` are the
only code that writes `entries` or changes `accounts.balance_cents`. Each call is one `BEGIN IMMEDIATE` transaction: the legs
must sum to 0, and accounts that may not go negative (everything except `system:*` and `loan`) are checked before commit.
Nothing in `routes`, `modules` or `public/` may touch those tables directly; a module that needs money to move calls the
ledger. Entries are append-only (database triggers refuse UPDATE and DELETE), and further triggers
(`migrations/002_ledger_guard.sql`) refuse any change to `accounts.balance_cents` and any insert into `entries` or `txns` unless `ledger.post()` has
raised the `ledger_lock` flag. SQLite has no session variables, so the flag is a one-row table set and cleared inside post()'s own
`BEGIN IMMEDIATE` transaction: no other connection ever sees it raised, so even a hand-typed UPDATE in the sqlite3 shell is refused.
Mistakes are fixed with `ledger.reverse(txn)`, a compensating transaction; nothing is edited or deleted. `ledger.audit()` re-derives everything from
entries and reports: do entries sum to 0, does every transaction balance, do cached balances match, is anything
negative that should not be. Money supply is minus the `system:mint` balance. The teacher console shows the audit.

## Architecture

```
server.js          starts the HTTP server on 127.0.0.1 and dispatches each request (session check, role check, same-origin POST check)
lib/http.js        request helpers: JSON bodies, the session and trusted-device cookies, the client address behind the proxy
lib/routes.js      the core API routes: me, setup, login (rate limited), logout, statements, the teacher console
lib/streams.js     Server-Sent Events at /api/stream
lib/static.js      static files from public/ and modules/*/ui
lib/app.js         assembles db + ledger + world + players + modules (used by server, tests and sim)
lib/db.js          SQLite in WAL mode, numbered migrations (migrations/*.sql), withTxn (BEGIN IMMEDIATE / savepoints)
lib/ledger.js      the only way money moves
lib/world.js       season dates, the world month (the world teacher advances it by hand), close() a season, onTick() hook registry
lib/policy.js      who may do what: a teacher sees only their own classes (404 otherwise); only the world teacher moves the clock
lib/players.js     teachers (the setup teacher, plus others by invite link), classes, pseudonymous students (AdjectiveAnimal42 + PIN, scrypt), sessions
lib/modules.js     defineModule (validation) and the loader; config/vdaa.json lists enabled modules per course
lib/kernel.js      the facade `k` a module receives instead of `app` (namespaced ledger, players read API, audit, events, policy)
modules/<id>/      index.js is `export default defineModule({ ... })` (contract: docs/modules.md) and ui/*.js; a large module keeps its
                   functions in topic files beside index.js, listed in the comment at the top of its index.js
public/            index.html (students), teach.html (teacher), theme.css (all look-and-feel tokens), app.css, ui.js
scripts/sim.mjs    bot simulator: money supply, average, median and Gini per world month
```

A module's routes are mounted at `/api/<id>/...`, only for classes whose course enables the module. A panel is an ES module
in `modules/<id>/ui/` that exports `render(el, { me, onRefresh, on })`; the student app draws one door per panel and opens it when clicked.
`bank-basic` is the example:
- a chequing account is opened when a student card is created, empty; the $500 welcome `grant` from `system:mint` is paid on the
  student's FIRST LOGIN (once, however many times they log in), so spare cards hold no money;
- student-to-student transfers are OFF until the teacher turns them on for a class. Then: same-class recipients only (never
  teachers or system accounts), a per-transfer cap and a rolling-24-hour cap (teacher-set, default $50 and $100), generated
  memos only (no free text), every transfer written to `audit_log`;
- the teacher console shows a Transfers feed (who, to whom, how much, when) with a Reverse button that posts a compensating
  transaction (refused if the recipient has already spent the money).

`jobs` (Phase 1A, `docs/phase1.md`) is the Job Centre and payroll:
- twelve entry-level Alberta jobs in `jobs_catalogue` (wages from ALIS, each row with its URL, check date and a note when the wage is
  from a related profile or illustrative; see `modules/jobs/catalogue.js`); a student holds one job, the teacher can assign or remove
  it and turn jobs off per class;
- each world month is a pay period: one `jobs.pay` transaction per student with a job (mint pays the gross, chequing gets the net,
  the deductions go to the sink) and a pay stub row; idempotent per student and month;
- `modules/jobs/payroll.js` is pure integer-cent payroll for Alberta, monthly, basic claims, from CRA T4127 (122nd edition,
  January 1, 2026): CPP, CPP2, EI, federal and Alberta tax, every constant cited to its T4127 section or table. The 2026 constants
  must be re-read from the new T4127 edition each January.

## Teachers and seasons

The teacher who runs first-time setup is the **world teacher**: they alone advance or configure the world clock, close seasons and
make invite links (`POST /api/teach/invites`, a single-use link valid 7 days; only its hash is stored). Another teacher joins at
`/teach?invite=<token>` with a pseudonym and a 12+ character passphrase, and then sees and manages only the classes they create:
anyone else's class, student or transfer is a 404, and the clock controls are read-only for them. The exception is the leaderboards panel, which shows every teacher what students see town-wide: the top 10 (pseudonyms), each class's name, size and median score, and award winners with their class names. Closing a season saves each
student's net worth (`season_results`), posts every balance to the sink as `core.season_reset` (the ledger stays balanced), and
stops the clock; the world teacher then starts the next season, which takes all classes with it. Students keep their username, PIN
and class, money starts again from zero, and `bank-basic` pays each returning student a new welcome grant on their next login.

## Privacy

The system never asks for real names, emails or birthdates, for teachers either: a teacher is a chosen pseudonym and a passphrase, and an invite
link carries only a random token (stored hashed, spent on first use, throttled like a login). A student is a teacher-issued pseudonym plus a 6-digit PIN,
hashed with scrypt. PINs are shown once, when generated or reset, to print the cards; the name-to-username map stays with
the teacher, offline. The places someone can type free text are a teacher's chosen username, class (block) names and a student's short promotion reflection (500 characters); the system does not screen them, so teachers should use a pseudonym and remind students not to put personal information in reflections. Login attempts are counted before the slow PIN check, so a burst of parallel guesses cannot slip
through (`lib/throttle.js`). Students: 5 tries per minute per (username, IP), a hard cap of 30 failed tries per hour per username
(a 6-digit PIN would take years), and 600 failed tries per IP per 15 minutes. The pair limit is checked before anything is
counted against the IP, so one student spraying wrong PINs at a classmate is stopped at 5 a minute and never uses up the
address's budget; 600 is only the ceiling for one address trying everything, and a whole class of 30 sharing the school's NAT
uses a few dozen. An IPv6 address counts as its /64. The console's "Login trouble" list shows students with 3+ wrong
tries (username, count, last time); Unlock or Reset PIN clears all their counters. Teacher accounts are never locked for good: they rely on a passphrase
of 12+ characters (enforced at setup and on change), a progressive delay (up to 2 s; every failed login gets the same one, whatever the
username, so timing does not tell teacher names apart), and a per-username budget of
20 wrong tries per 15 minutes from any address (IPv6 rotation defeats the IP limit); a guesser gets at most 80 tries an hour. Because a
refused try is not counted, a stranger could otherwise keep that budget full for ever, so a **trusted device** is exempt: a successful
teacher login (or first-run setup, or joining) sets a long-lived HttpOnly `td` cookie (random token, only its hash is stored in
`trusted_devices`, 180 days after last use, `Secure` over https), and a login that presents it skips the strangers' budget and the IP ceiling (it keeps its own
buckets, which strangers cannot fill: 5 a minute per address and 20 wrong per 15 minutes per username, so a *copied* cookie is not a free
guessing licence; a thief who fills it can lock out the teacher's trusted browsers only until the teacher changes the passphrase, which
forgets every trusted device, and the teacher's open session can do that). A new browser during an attack gets "Too many wrong passphrases for this
account from other devices..." and waits at most 15 minutes. Changing the passphrase forgets every trusted device except the browser
that changed it. `/api/teach/passphrase` caps guesses at the current passphrase at 10 an hour per session, and a session without the
cookie also shares the budget. A successful login gives its slot back.
**On a shared computer** (a classroom machine) use **Log out and forget this device** in the teacher console: a plain Log out keeps the
cookie, so you are not locked out of your own browser, but this one also deletes the device and clears the cookie.
**Locked out with no open session** (only possible if someone stole your `td` cookie AND keeps guessing): the login counters live
in memory, so `sudo systemctl restart vdaa` on the VM clears them (sessions and data are untouched); log in at once and change the
passphrase, which forgets every trusted device including the stolen one.
**Sessions** last at most 14 days and end after 8 hours without a request (students) or 12 hours (teachers). Logging in ends the
session the browser had. **Log out everywhere** (student and teacher pill bars) ends every session of that player; trusted devices
stay. Over https the cookies are `__Host-sid` and `__Host-td` (a sibling `*.michaelhtang.com` app cannot set or shadow them) and every
response carries HSTS; a legacy `sid`/`td` cookie is still read once and moved to the new name, but only for 14 days after the first
boot with the rename (`VDAA_LEGACY_COOKIES_UNTIL=2026-12-01` overrides). Cookie names are compared raw (never URL-decoded), and a
name sent twice counts as absent. Cookie values the server cannot decode are ignored. Each player has at most 3 open event streams:
a 4th closes the oldest, which gets a `replaced` event and waits ("Open in another tab — click to use here") instead of reconnecting.
**Known trade-off:** a guesser rotating addresses can still tell a teacher username apart at about the 21st wrong try, when the
teacher budget answers with its own message ("…from other devices…"); the message stays because it tells the real teacher what to do.
**If one address hits the 600 ceiling** (a student or script spraying fake usernames), everyone behind it is refused for up to 15
minutes; the world teacher sees it under Login trouble > Blocked network addresses (address, tries, when it frees) and presses Unblock
(`POST /api/teach/blocked-ips/unblock`, logged in `audit_log`); only the world teacher, because an address is shared by whole classes.
A teacher on a trusted device can always sign in to do it. First-run setup has its own bucket (5 wrong tokens a minute per address, no
account lock); joining by invite has its own key per token.
Known limit: a classmate behind the same public IP shares your per-(username, IP) bucket, so a persistent
poller can still make you wait; it cannot lock you for more than the hour cap, you appear in Login trouble, and Unlock fixes it.
No student browser contacts a third party: fonts and art are served from this origin and the Content-Security-Policy allows
nothing else. All request input goes through the validated readers in `lib/input.js` (`str`, `int`, `bool`, `idParam`): a wrong
type is a 400, never a 500; a fuzz test sweeps every POST route with crafted bodies.

## Theming

Everything visual is in `public/theme.css`: the "Night Shift" palette, taken from the lesson art (deep navy, royal blue, ice blue,
a coral accent for the one main action, gold for money), the fonts, the sharp corners, the flat `.scene` background cut by two
angular shards, the `.glass` panel (solid now; the class name is from the earlier glass theme), the top-right bar and the mascot
slot. `app.css` and the module stylesheets read those tokens. On a screen 1100 px wide or more the home screen's building tiles
become a rail down the left. Motion is turned off under `prefers-reduced-motion`.

The earlier theme put a photo of the school behind each zone. Those photos are still in `public/art/scenes/` (a night and a day
version per zone, made on Mr. Tang's ComfyUI); the comment above `.scene` in theme.css says how a theme brings them back.
`public/daylight.js` still sets day or night on `.scene` from real Edmonton sunrise and sunset; this theme does not use it.

The DAA Wolf (`public/art/wolf.png` and one file per class outfit) is drawn in the lesson-art style; the masters are in
`design/mascot/`.

Fonts (Chakra Petch for headings and labels, Barlow for text) are self-hosted in `public/fonts/` as woff2, the Latin subset as
served by Google Fonts, each family with its SIL Open Font License text. `theme.css` declares each face over a range of weights, so
the `font: 800 ...` shorthands across the stylesheets pick a real face and never a synthesised bold.

## Deploy (vdaa.michaelhtang.com on the GCP VM)

One zero-dependency Node 24 process on `127.0.0.1:3020` (free: 3000 Gogs, 3001 TradeLab, 3002 DAAHS, 3010 STAX North), behind nginx and
Cloudflare, with the same layout as STAX North. `../deploy-vdaa.sh` (beside the other deploy scripts, outside this repo) runs the
quick tests, sends the files and does everything on the VM; it is idempotent. Files here: `deploy/vdaa.service` (hardened systemd
unit, `UMask=0077`, `ProtectSystem=strict`, writes only `/srv/vdaa/data`), `deploy/nginx-vdaa.conf`, `deploy/vdaa-backup.{service,timer}`.

Layout on the VM: code `/srv/vdaa/app` (root-owned, previous release in `app.old`), data `/srv/vdaa/data` (user `vdaa`, mode 700,
`vdaa.db` and `backups/`), secrets `/etc/vdaa.env` (root, mode 0600, holds only `VDAA_SETUP_TOKEN`; the unit reads it with
`EnvironmentFile=`, nothing secret is in the unit, the repo or the script).

**One-time steps (run by Mr. Tang; Claude does not touch Cloudflare, certbot or the VM):**

1. Cloudflare: add an **AAAA** record `vdaa` -> `2600:1900:4000:159d::`, **Proxied** (orange cloud). SSL stays Full (strict).
2. `cd ~/claude-workspace && ./deploy-vdaa.sh`. On the first run it creates the system user `vdaa`, `/srv/vdaa/data` (+ `backups/`), `/etc/vdaa.env`
   with a random `VDAA_SETUP_TOKEN`, the unit and the nightly backup timer, and the nginx site (port 80 only), then starts the
   service and checks `http://127.0.0.1:3020/api/me`. Every deploy first takes a database backup (and stops if that fails), and if the new
   version does not answer it puts back the previous code AND unit files and prints the pre-deploy backup path, since the new code's first
   boot may already have migrated the database (restore it with `scripts/restore.md` if the old release misbehaves). It also stops, changing
   nothing, if `00-cloudflare-realip.conf` is missing or lacks the Cloudflare IPv6 ranges.
3. certbot, once the record exists (on the VM): `sudo certbot --nginx -d vdaa.michaelhtang.com --non-interactive --agree-tos --register-unsafely-without-email --no-redirect`.
   Keep `--no-redirect`: port 80 must keep serving or Cloudflare loops.
4. Read the setup token: `gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command 'sudo cat /etc/vdaa.env'`. Open
   https://vdaa.michaelhtang.com/teach, enter the token, a pseudonym and a 12+ character passphrase. You are the world teacher. The token
   is only used here; to retire it, delete the line, `sudo systemctl restart vdaa` (setup is then closed for good, and a teacher already exists anyway).
5. Check: `curl -s https://vdaa.michaelhtang.com/api/me` shows `needsSetup:false`; `systemctl list-timers vdaa-backup` shows the next run;
   `sudo systemctl start vdaa-backup && ls -l /srv/vdaa/data/backups` makes the first backup now.

Real client IPs: the VM's `00-cloudflare-realip.conf` makes nginx's `$remote_addr` the visitor (only when the peer really is
Cloudflare); `nginx-vdaa.conf` then overwrites `CF-Connecting-IP` with it, and the app trusts that header only from the local nginx
(`TRUSTED_PROXIES=127.0.0.1,::1`), so a forged header cannot dodge the login limits. The deploy script warns if that file is missing.
Live updates (`/api/stream`) have buffering off and a 1 h read timeout; the app pings every 25 s, inside Cloudflare's 100 s limit.
Later config changes to the nginx site are not re-applied by the script (certbot edits the file); edit `/etc/nginx/conf.d/vdaa.conf` by hand.
The script does check one line: if the installed site lacks `proxy_set_header X-Forwarded-Host $host;` (added after the first install) it prints
a warning with the exact line to add after the `Host` line, then `sudo nginx -t && sudo systemctl reload nginx`.

## Backup and restore

`scripts/backup.mjs [db] [dir]` writes a WAL-safe copy with `VACUUM INTO` (a consistent snapshot while the server keeps writing; a plain
`cp` would miss the `-wal` file), checks it with `PRAGMA integrity_check`, renames it into place as `vdaa-YYYY-MM-DD-HHMMSS.db` (UTC, never overwriting an existing name,
mode 0600) and keeps the newest `BACKUP_KEEP` (default 14) of that `BACKUP_PREFIX` series; each deploy takes its own `vdaa-predeploy-*` copy (newest 5). On the VM `vdaa-backup.timer` runs it nightly at 07:20 UTC.
`scripts/pull-backup.sh [dir]` (run on the Mac) copies the newest one to `~/vdaa-backups` over the IAP ssh path, verifying its sha256 and
integrity. `scripts/restore.md` has the restore steps and the checks (`/api/me`, ledger audit). `test/backup.test.js` backs up a database
that another process is writing to, restores the copy and audits it.
