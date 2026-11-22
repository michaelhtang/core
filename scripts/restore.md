# Restoring a core backup

Backups are `vdaa-YYYY-MM-DD-HHMMSS.db` (UTC) in `/srv/vdaa/data/backups/` on the VM, one self-contained SQLite file each, made nightly at
07:20 UTC by `vdaa-backup.timer` (`scripts/backup.mjs`, `VACUUM INTO`, newest 14 kept). Every deploy also takes a `vdaa-predeploy-YYYY-MM-DD-HHMMSS.db` copy first (newest 5 kept, a separate series so deploys never push the nightlies out). `scripts/pull-backup.sh` copies the newest nightly backup to
the Mac (not the pre-deploy copies). Everything after the backup time is lost on restore, so pick the newest good one. All commands run on the VM
(`gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap`).

## Restore

The data directory is private to the `vdaa` user (mode 700), so every command below uses `sudo` and absolute paths; nothing depends on
the current directory.

```sh
D=/srv/vdaa/data
sudo ls -1 $D/backups                                                 # list the backups, pick one
B=vdaa-2026-10-23-072005.db                                             # the backup to restore
# from the Mac instead: gcloud compute scp --zone "$ZONE" --tunnel-through-iap ~/vdaa-backups/$B "$VM":/tmp/$B
#                       then on the VM: sudo install -m 600 -o vdaa -g vdaa /tmp/$B $D/backups/$B && rm /tmp/$B

sudo systemctl stop vdaa                                              # 1. stop the service (the db must not be open)
sudo mv $D/vdaa.db $D/vdaa.db.broken-$(date +%s)                      # 2. keep the damaged one aside; never delete it first
sudo rm -f $D/vdaa.db-wal $D/vdaa.db-shm                              #    a stale WAL from the old file must not meet the new one
sudo install -m 600 -o vdaa -g vdaa $D/backups/$B $D/vdaa.db          # 3. copy back, owned by vdaa, mode 0600
sudo systemctl start vdaa                                             # 4. start; migrations run on boot and are a no-op on a current file
```

(A backup taken by an older release of the code is brought up to date by the migrations on boot. A backup taken by a NEWER release than
the code now running has migrations the code does not know and should not be restored under it.)

## Check it

```sh
curl -s http://127.0.0.1:3020/api/me                                  # {"user":null,"world":null,"needsSetup":false,...}  needsSetup must be false
sudo -u vdaa env DATA_DIR=/srv/vdaa/data node --input-type=module -e "
import { createApp } from '/srv/vdaa/app/lib/app.js';
const app = await createApp({ dataDir: '/srv/vdaa/data' });
const a = app.ledger.audit();
console.log(a.ok ? 'ledger audit OK' : a.problems, 'supply', a.moneySupply, 'accounts', a.accounts, 'entries', a.entries);
app.db.close();"
sudo journalctl -u vdaa -n 20 --no-pager                                  # no errors
```

`needsSetup: true` means the file restored is empty or the wrong one: stop, and restore the next backup. The teacher console
(`/teach`) shows the same audit under Audit; sign in with the teacher passphrase as it was when the backup was made. Open sessions
are in the database, so students stay signed in; throttle counters are in memory and start empty.

If the restored file is no good, `sudo systemctl stop vdaa` and put `$D/vdaa.db.broken-*` back the same way (`sudo ls $D` shows its name). Once everything is fine, delete the
`.broken-*` file by hand.

## Restoring onto a fresh machine or for a test

Copy the `.db` to `<DATA_DIR>/vdaa.db` (no `-wal` or `-shm` beside it), then `DATA_DIR=<DATA_DIR> node server.js`. This is exactly
what `test/backup.test.js` does with a backup taken while another process was writing: it opens, migrates, and passes
`ledger.audit()`.
