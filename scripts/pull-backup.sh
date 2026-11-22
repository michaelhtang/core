#!/bin/bash
# Copies the newest nightly backup from the VM to this Mac over the same IAP ssh path the deploys use. Run by Mr. Tang, by hand:
#   scripts/pull-backup.sh [local-dir]        default ~/vdaa-backups (created 0700; files 0600; nothing is deleted locally)
# The file is streamed through `sudo cat` (the data directory is private to the vdaa user), then its sha256 is compared with the
# one computed on the VM and its SQLite integrity_check is run here before the script says it worked.
set -euo pipefail
dir="${1:-$HOME/vdaa-backups}"
umask 077
mkdir -p "$dir"
: "${VM:?set VM to the VM name}" "${ZONE:?set ZONE to the VM zone}"
ssh_vm() { gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "$1" 2> >(grep -v -E "NumPy|please see|post-quantum|store now|be upgraded|^WARNING: *$|^$" >&2); }

remote=$(ssh_vm 'sudo ls -1 /srv/vdaa/data/backups/ | grep -E "^vdaa-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}\.db$" | sort | tail -1' | tr -d '\r')
[ -n "$remote" ] || { echo "no backup found on the VM (is vdaa-backup.timer running? systemctl list-timers vdaa-backup)"; exit 1; }
want=$(ssh_vm "sudo sha256sum /srv/vdaa/data/backups/$remote" | cut -d' ' -f1)
ssh_vm "sudo cat /srv/vdaa/data/backups/$remote" > "$dir/$remote.part"
got=$(shasum -a 256 "$dir/$remote.part" | cut -d' ' -f1)
[ "$want" = "$got" ] || { rm -f "$dir/$remote.part"; echo "checksum mismatch, copy discarded"; exit 1; }
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const r = db.prepare('PRAGMA integrity_check').all().map((x) => x.integrity_check);
if (r.length !== 1 || r[0] !== 'ok') { console.error('integrity_check failed: ' + r.join('; ')); process.exit(1); }
" "$dir/$remote.part"
mv "$dir/$remote.part" "$dir/$remote"
chmod 600 "$dir/$remote"
echo "pulled $dir/$remote ($(du -h "$dir/$remote" | cut -f1))"
