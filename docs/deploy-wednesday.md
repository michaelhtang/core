# Getting vDAA live for the Block 4 playtest (Wednesday 2026-11-04)

Everything runs on the free GCP VM (e2-micro, IPv6-only) behind the free Cloudflare plan, next to TradeLab, STAX North and DAAHS. Nothing paid is added. Steps marked **you** are yours because Cloudflare, certbot and the VM are yours; the rest I did on 2026-11-02 (main @ the commit this file arrived in).

**State on 2026-11-02 (night): live.** Steps 1–3 are done: the record exists, the deploy ran, the certificate is issued, and https://vdaa.michaelhtang.com answers from outside with `needsSetup:true`, the CSP and HSTS headers, and the scene images. The service and the nightly backup timer are active. **Left: steps 4 and 5** (the setup token and your teacher account, then the Block 4 class and cards) and the Tuesday smoke test.

## Monday or Tuesday evening (about 30 minutes)

### 1. Check the Cloudflare record (**you**)
In the Cloudflare DNS page for michaelhtang.com, `vdaa` must be an **AAAA** record to `2600:1900:4000:159d::`, **Proxied** (orange cloud), SSL mode Full (strict), the same as `stax`. If it is a CNAME or an A record, replace it. Error 1016 is almost always this.

### 2. Deploy (**you**, from your Mac)
```bash
cd ~/claude-workspace && ./deploy-vdaa.sh
```
It runs the quick tests, sends the files, and on the first run creates the `vdaa` user, `/srv/vdaa/data`, `/etc/vdaa.env` (random setup token), the hardened service, the nightly backup timer and the nginx site, then checks `http://127.0.0.1:3020/api/me` on the VM. It stops, changing nothing, if the Cloudflare real-IP file is missing. Expect the last line to say `-> 000` or `52x` until step 3 is done.

If it fails, paste me the output. The script rolls back by itself.

### 3. Certificate, once (**you**, on the VM)
```bash
gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap
```
```bash
sudo certbot --nginx -d vdaa.michaelhtang.com --non-interactive --agree-tos --register-unsafely-without-email --no-redirect
```
Keep `--no-redirect`; port 80 must keep serving or Cloudflare loops. Then from your Mac:
```bash
curl -s https://vdaa.michaelhtang.com/api/me
```
should print JSON with `needsSetup:true`.

### 4. Become the world teacher (**you**)
```bash
gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command 'sudo cat /etc/vdaa.env'
```
Open https://vdaa.michaelhtang.com/teach, enter that token, a pseudonym and a 12+ character passphrase. The token is used only here.

### 5. Make the class (**you**, in the console, 5 minutes)
- New class: name **Block 4**, course FinTech 10 (or 20/30 to match the block).
- Generate students: the block's headcount plus 3 spares.
- Print the PIN cards (the console's print view). Cards carry a username and a 6-digit PIN, no names. Keep your own list of who got which card on paper, not in the game.
- Leave the pace at 1 month per day and auto-advance **off** for the playtest; you advance by hand at minute 10.
- First backup now, so the timer is proven:
```bash
gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command 'sudo systemctl start vdaa-backup && sudo ls -l /srv/vdaa/data/backups'
```

## Tuesday night: ten-minute smoke test on real devices (**you**)
The game has never been seen on a real phone or Chromebook. Use one spare PIN card on each.

| | Phone | Chromebook |
|---|---|---|
| Log in with the card at https://vdaa.michaelhtang.com | | |
| Home screen: balance, Today card, the doors; no "null", no overlap at phone width | | |
| Open Job Centre, pick a job | | |
| Open Bills, Bank, Net Worth, Amphitheatre (any error text?) | | |
| Arcade: play one round of Bill Dash to the end (does it feel smooth? the in-app browser could never tell us) | | |
| Town Walk: tap to move, pick up one item, see the other device's sprite | | |
| Console on your laptop: advance one month; both devices update without reload | | |
| Log out, log in again | | |

Anything odd: screenshot and send it to me Tuesday night. A cosmetic issue is fine for Wednesday; a login or advance problem is not, and then we use the fallback.

## Wednesday, Block 4
Follow `docs/playtest-block4.md`. After class, pull the day's data to your Mac for me to read the counts from:
```bash
~/claude-workspace/vdaa/scripts/pull-backup.sh
```
(It copies the newest nightly backup; run `sudo systemctl start vdaa-backup` on the VM first if you want the same-day state.)

## Fallback if the deploy is not working by Tuesday night
Run it on your laptop on the school Wi-Fi:
```bash
cd ~/claude-workspace/vdaa && VDAA_SETUP_TOKEN=playtest PORT=3020 npm start
```
Students open `http://<your laptop's IP>:3020`. Test from a Chromebook on Tuesday: school networks often block device-to-device traffic, and if that fails the playtest moves to the first day the VM is up.

## What changed in the code for this
- `public/theme.css`: the town, job and venture-row scenes and the fallback scene use the **gate** photo instead of the Agora. PLAN.md requires the Indigenous education lead's review of the Agora art before students see it; the Agora files stay in place for when that is done.
- Nothing else. The game students see on Wednesday is `v21-stagecosts` plus this swap.

## Approval note
PLAN.md §8 records that school approval for the pilot is not written down anywhere. What the playtest stores: a pseudonym, a PIN hash, and game history for a 20-minute session; no names, no emails. That is your and your admin's call to make before Wednesday; nothing here depends on the answer except whether Wednesday happens.
