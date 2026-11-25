#!/usr/bin/env bash
# Refresh this public copy of core from the private vdaa repo's main branch.
#
#   .public/refresh.sh            build the clean copy and commit it here (nothing leaves your Mac)
#   .public/refresh.sh --push     same, then push to GitHub
#
# VDAA_DIR  the private repo (default: ../vdaa next to this folder)
# REF       what to publish (default: main)
# ARCHIVE   a `git archive` .tar.gz to use instead of VDAA_DIR (LABEL names it in the commit message)
#
# Only committed files on REF are used. Private items are removed, a few lines are blanked, and
# the result is scanned; any hit stops the script before anything is committed or pushed.
# README.md, LICENSE and .public/ belong to this public copy and are kept as they are.
set -euo pipefail
die() { echo "refresh: $*" >&2; exit 1; }

PUB=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$PUB/.git" ] && [ -f "$PUB/.public/refresh.sh" ] || die "run this from the public core clone"
SRC=${VDAA_DIR:-$PUB/../vdaa}
REF=${REF:-main}
PUSH=0; [ "${1:-}" = "--push" ] && PUSH=1

cd "$PUB"
[ -z "$(git status --porcelain)" ] || die "this public copy has uncommitted changes; commit or discard them first"
if [ "$PUSH" = 1 ]; then git pull --ff-only -q || die "could not update from GitHub"; fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/tree"; mkdir "$OUT"
if [ -n "${ARCHIVE:-}" ]; then
  tar -xzf "$ARCHIVE" -C "$OUT"; LABEL=${LABEL:-archive}
else
  git -C "$SRC" rev-parse --verify -q "$REF^{commit}" >/dev/null || die "no $REF in $SRC"
  git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
  LABEL="$(git -C "$SRC" describe --tags --always "$REF") ($(git -C "$SRC" rev-parse --short "$REF"))"
fi

cd "$OUT"
# 1. Private items: clean-room recon notes, unreviewed Agora art, the ComfyUI gateway certificate.
rm -rf replica design/comfystudio.pem
rm -f design/agora-*.png design/scenes/agora*.png public/art/scenes/agora-*.webp
# 2. The private README (setup and deploy notes) becomes docs/running.md; the public README is kept below.
[ -f README.md ] && mv README.md docs/running.md
perl -pi -e 's#Start with the top-level `README.md` \(run, architecture, privacy, deploy, backup\)#Start with `docs/running.md` (run, architecture, privacy, deploy, backup)#' docs/README.md
# 3. Home network address of the art PC.
perl -pi -e 's#https://192\.168\.\d+\.\d+:8443#https://localhost:8443#g' tools/comfy-gen.mjs
# 4. The scene test lists Agora pictures that are no longer here.
perl -pi -e "s/\['gate', 'agora', 'council'/['gate', 'council'/" test/api.test.js
# 5. Server name and zone.
FILES=$(grep -rlIE 'us-central1-a|compute (ssh|scp) app|GCP VM ["`]app["`]| app:/' . || true)
[ -n "$FILES" ] && perl -pi -e 's/--zone us-central1-a/--zone "\$ZONE"/g; s/compute ssh app /compute ssh "\$VM" /g; s/ app:\/tmp/ "\$VM":\/tmp/g; s/GCP VM "app"/GCP VM/g; s/GCP VM `app`/GCP VM/g' $FILES
if [ -f scripts/pull-backup.sh ] && ! grep -q 'VM:?' scripts/pull-backup.sh; then
  perl -0pi -e 's/^ssh_vm\(\)/: "\${VM:?set VM to the VM name}" "\${ZONE:?set ZONE to the VM zone}"\nssh_vm()/m' scripts/pull-backup.sh
fi
# 6. Files that belong to the public copy.
cp "$PUB/README.md" "$PUB/LICENSE" .
mkdir -p .public && cp -R "$PUB/.public/." .public/

# 7. Safety scan. Any hit stops here.
BAD_FILES=$(find . -type f \( -iname '*.db' -o -iname '*.db-wal' -o -iname '*.db-shm' -o -iname '*.sqlite*' -o -iname '*.pem' -o -iname '*.key' -o -iname '*.p12' -o -iname '.env*' -o -iname '*.bundle' -o -path './replica/*' -o -path './data/*' -o -iname 'agora*.png' -o -iname 'agora*.webp' \) | head -20)
[ -z "$BAD_FILES" ] || die "private files would be published:
$BAD_FILES"
BAD_LINES=$(grep -rnIE '192\.168\.[0-9]+\.[0-9]+|us-central1-a|compute ssh app |BEGIN [A-Z ]*PRIVATE KEY|sk-ant-[A-Za-z0-9]|ghp_[A-Za-z0-9]{20}|github_pat_|AKIA[0-9A-Z]{16}|xox[bp]-[0-9]|AIza[0-9A-Za-z_-]{30}|@gmail\.com|@epsb\.ca' . --exclude-dir=.public | head -20 || true)
[ -z "$BAD_LINES" ] || die "private-looking lines would be published (nothing was committed):
$BAD_LINES"

# 8. Replace the public copy's files with the clean tree and commit.
cd "$PUB"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$OUT/." .
git add -A
if git diff --cached --quiet; then echo "refresh: already up to date with $LABEL"; exit 0; fi
git diff --cached --stat | tail -1
git -c user.name="Mr. Tang" -c user.email="61135115+michaelhtang@users.noreply.github.com" \
  commit -q -m "Update from main at $LABEL"
echo "refresh: committed $(git rev-parse --short HEAD) from $LABEL"
if [ "$PUSH" = 1 ]; then git push -q origin HEAD && echo "refresh: pushed to GitHub"; else echo "refresh: not pushed (run with --push)"; fi
