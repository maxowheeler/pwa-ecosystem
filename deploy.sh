#!/bin/bash
# deploy.sh — Deploy PWA files (and the Office Status BYOS backend) from
# staging to production.
#
# Usage (run from your Mac — NOT over SSH):
#   /opt/homebrew/bin/bash /Volumes/shyguy/apps/deploy.sh
#
# Why the explicit /opt/homebrew/bin/bash path: this script uses
# associative arrays (declare -A), which need Bash 4+. macOS ships Bash
# 3.2 as /bin/bash (Apple hasn't updated it in years over licensing), and
# `brew install bash` does NOT change what plain `bash` resolves to —
# it just installs a second copy. You have to call the new one by its
# full path, or fix your $PATH order yourself, one or the other.
#
# Workflow:
#   1. Drop new files into the Pi's staging folder from Finder (shows up
#      as /Volumes/shyguy/staging on your Mac via the SMB mount)
#   2. Run this script directly from your Mac's Terminal — no SSH needed,
#      since the Mac can already read and write the Pi's filesystem
#      through that same mount.
#   3. Script archives old versions, deploys new ones, reports results
#   4. If any Office BYOS backend file changed this run, it also runs
#      `gcloud run deploy` from the office-byos folder — requires gcloud
#      CLI installed + authenticated on your Mac (already true, since
#      that's where you've been running it manually).
#
# FILE ROUTING TABLE — maps staging filename → destination directory.
# Add new files here when new apps or shared modules are introduced.
# Files not in this table will be flagged as unknown and skipped —
# EXCEPT .png files, which fall back to office-byos/assets/ (see the
# deploy loop below) so new icon keys don't require editing this table.
#
# Re-downloaded duplicates (e.g. "bike-index (2).html" from a second
# Finder drag) are matched too — the " (2)" suffix is stripped before
# lookup, and the file is deployed under its original clean name.

# ── Bash version guard ──────────────────────────────────────────────
# Fails with a clear message instead of a cryptic "declare: -A: invalid
# option" if someone runs this with the system's stock Bash 3.2.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "This script needs Bash 4+ (it uses associative arrays)."
  echo "You're running: $(bash --version | head -1)"
  echo "Run it with Homebrew's bash instead, e.g.:"
  echo "  /opt/homebrew/bin/bash $0"
  exit 1
fi

# ── Pi mount — single source of truth for every path below ─────────
# Confirmed via: mount | grep shyguy
#   //shyguy@HOMEPI._smb._tcp.local/shyguy on /Volumes/shyguy (smbfs...)
# If this mount point ever changes, this is the only line to update —
# everything else (FILE_DEST, STAGING_DIR, BACKUP_DIR, OFFICE_BYOS_DIR)
# is built from it below.
PI_MOUNT="/Volumes/shyguy"

declare -A FILE_DEST=(
  # Shared modules
  ["config.js"]="$PI_MOUNT/apps/shared"
  ["storage.js"]="$PI_MOUNT/apps/shared"
  ["sync.js"]="$PI_MOUNT/apps/shared"
  ["ui.js"]="$PI_MOUNT/apps/shared"
  ["theme.css"]="$PI_MOUNT/apps/shared"
  ["versions.js"]="$PI_MOUNT/apps/shared"

  # Journal app
  ["journal-index.html"]="$PI_MOUNT/apps/journal"
  ["journal.js"]="$PI_MOUNT/apps/journal"
  ["journal.css"]="$PI_MOUNT/apps/journal"
  ["viewall.html"]="$PI_MOUNT/apps/journal"
  ["viewall.js"]="$PI_MOUNT/apps/journal"
  ["journal-sw.js"]="$PI_MOUNT/apps/journal"
  ["journal-manifest.json"]="$PI_MOUNT/apps/journal"

  # Bike app
  ["bike-index.html"]="$PI_MOUNT/apps/bike"
  ["bike.js"]="$PI_MOUNT/apps/bike"
  ["bike.css"]="$PI_MOUNT/apps/bike"
  ["bike-sw.js"]="$PI_MOUNT/apps/bike"
  ["bike-manifest.json"]="$PI_MOUNT/apps/bike"

  # Office Status app (PWA front end)
  ["office-index.html"]="$PI_MOUNT/apps/office"
  ["office.js"]="$PI_MOUNT/apps/office"
  ["office.css"]="$PI_MOUNT/apps/office"
  ["office-sw.js"]="$PI_MOUNT/apps/office"
  ["office-manifest.json"]="$PI_MOUNT/apps/office"
  ["list-pics.php"]="$PI_MOUNT/apps/office"

  # Office Status BYOS backend (Cloud Run — kept on the Pi as source of
  # truth, then pushed to Cloud Run by this script; see OFFICE_BYOS_DIR
  # and the deploy step at the bottom)
  ["server.js"]="$PI_MOUNT/apps/office-byos"
  ["Dockerfile"]="$PI_MOUNT/apps/office-byos"
  ["package.json"]="$PI_MOUNT/apps/office-byos"

  # PHP backend — handles push/pull sync for all apps' local data
  ["sync.php"]="$PI_MOUNT/apps/server"
)

# Some staging filenames differ from their deployed filename.
# Map staging name → deployed filename here.
declare -A FILE_RENAME=(
  ["journal-index.html"]="index.html"
  ["journal-sw.js"]="sw.js"
  ["journal-manifest.json"]="manifest.json"
  ["bike-index.html"]="index.html"
  ["bike-sw.js"]="sw.js"
  ["bike-manifest.json"]="manifest.json"

  ["office-index.html"]="index.html"
  ["office-sw.js"]="sw.js"
  ["office-manifest.json"]="manifest.json"
)

STAGING_DIR="$PI_MOUNT/staging"
BACKUP_DIR="$PI_MOUNT/apps/shared/backups"
OFFICE_BYOS_DIR="$PI_MOUNT/apps/office-byos"
TODAY=$(date +%Y-%m-%d)

# Cloud Run target for the Office Status BYOS backend
GCP_PROJECT="global-thermo"
GCP_REGION="us-central1"
GCP_SERVICE="office-status-byos"

# ── Colour helpers ────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
err()  { echo -e "${RED}  ✗ $1${RESET}"; }

# Strip a macOS/Chrome duplicate-download suffix like " (2)" from just
# before the extension, so a re-dragged file (e.g. from re-downloading
# during a long editing session) still matches the routing table as if
# it were the original filename. Files without a suffix pass through
# unchanged.
clean_filename() {
  echo "$1" | sed -E 's/ \(([0-9]+)\)(\.[^.]*)?$/\2/'
}

# ── Preflight ─────────────────────────────────────────────────────
echo ""
echo "  PWA Deploy Script"
echo "  ──────────────────────────────────────"

if [ ! -d "$STAGING_DIR" ]; then
  err "Staging directory not found: $STAGING_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Scan staging ──────────────────────────────────────────────────
staged_files=()
for f in "$STAGING_DIR"/*; do
  [ -f "$f" ] && staged_files+=("$(basename "$f")")
done

if [ ${#staged_files[@]} -eq 0 ]; then
  warn "No files found in staging. Nothing to deploy."
  exit 0
fi

echo ""
echo "  Files in staging: ${staged_files[*]}"
echo ""

# ── Validate — flag unknown files but continue with known ones ────
unknown=()
deployable=()

for file in "${staged_files[@]}"; do
  clean_name=$(clean_filename "$file")

  if [ -n "${FILE_DEST[$clean_name]+_}" ]; then
    deployable+=("$file")
  elif [[ "$clean_name" == *.png ]]; then
    deployable+=("$file")   # routed via the office-byos assets fallback below
  else
    unknown+=("$file")
  fi
done

if [ ${#unknown[@]} -gt 0 ]; then
  for f in "${unknown[@]}"; do
    warn "Unknown file skipped: $f (not in FILE_DEST table, and not a .png)"
  done
  echo ""
fi

if [ ${#deployable[@]} -eq 0 ]; then
  err "No known files to deploy. Exiting."
  exit 1
fi

# ── Deploy loop ───────────────────────────────────────────────────
deploy_errors=0
byos_changed=false

for file in "${deployable[@]}"; do
  src="$STAGING_DIR/$file"
  clean_name=$(clean_filename "$file")

  if [ -n "${FILE_DEST[$clean_name]+_}" ]; then
    dest_dir="${FILE_DEST[$clean_name]}"
    deployed_name="${FILE_RENAME[$clean_name]:-$clean_name}"
  else
    # .png fallback — not in the table, routes to the BYOS art assets folder
    dest_dir="$OFFICE_BYOS_DIR/assets"
    deployed_name="$clean_name"
  fi

  dest="$dest_dir/$deployed_name"
  ext="${deployed_name##*.}"
  base="${deployed_name%.*}"

  # Ensure destination directory exists
  mkdir -p "$dest_dir"

  # Extract version from JS files (looks for: VERSION = '1.0.0')
  version=""
  if [ "$ext" = "js" ]; then
    version=$(grep -o "VERSION = '[^']*'" "$src" 2>/dev/null | grep -o "'[^']*'" | tr -d "'")
  fi

  # Extract version from CSS files (looks for: /* theme.css v1.0.0 */)
  if [ "$ext" = "css" ]; then
    version=$(grep -o "v[0-9]*\.[0-9]*\.[0-9]*" "$src" 2>/dev/null | head -1)
  fi

  # Archive current live file if it exists
  if [ -f "$dest" ]; then
    if [ -n "$version" ]; then
      archive_name="${base}.${version}.${TODAY}.${ext}"
    else
      archive_name="${base}.${TODAY}.${ext}"
    fi
    cp "$dest" "$BACKUP_DIR/$archive_name"
    if [ $? -eq 0 ]; then
      ok "Archived: $deployed_name → backups/$archive_name"
    else
      err "Archive failed for $deployed_name — skipping deploy of this file"
      (( deploy_errors++ ))
      continue
    fi
  fi

  # Copy new file into place
  cp "$src" "$dest"
  if [ $? -eq 0 ]; then
    if [ "$file" != "$deployed_name" ]; then
      ok "Deployed: $file → $(basename "$dest_dir")/$deployed_name"
    else
      ok "Deployed: $file → $(basename "$dest_dir")/"
    fi
    rm "$src"

    if [ "$dest_dir" = "$OFFICE_BYOS_DIR" ] || [ "$dest_dir" = "$OFFICE_BYOS_DIR/assets" ]; then
      byos_changed=true
    fi
  else
    err "Deploy failed: $file"
    (( deploy_errors++ ))
  fi
done

# ── Office BYOS → Cloud Run ─────────────────────────────────────────
# Only runs if something under office-byos actually changed this pass,
# so a PWA-only batch never triggers an unnecessary Cloud Run deploy.
if [ "$byos_changed" = true ]; then
  echo ""
  echo "  Office BYOS files changed — deploying to Cloud Run"
  echo "  ──────────────────────────────────────"

  if ! command -v gcloud >/dev/null 2>&1; then
    err "gcloud CLI not found on this machine."
    err "Install + authenticate gcloud on this Mac, or deploy manually from $OFFICE_BYOS_DIR"
    (( deploy_errors++ ))
  else
    gcloud run deploy "$GCP_SERVICE" \
      --source "$OFFICE_BYOS_DIR" \
      --region "$GCP_REGION" \
      --project "$GCP_PROJECT"

    if [ $? -eq 0 ]; then
      ok "Cloud Run deploy complete"
    else
      err "Cloud Run deploy failed — see gcloud output above"
      (( deploy_errors++ ))
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "  ──────────────────────────────────────"

if [ $deploy_errors -gt 0 ] && [ ${#unknown[@]} -gt 0 ]; then
  echo -e "  ${RED}Done with errors. $deploy_errors deploy failure(s), ${#unknown[@]} unknown file(s) skipped.${RESET}"
  exit 2
elif [ $deploy_errors -gt 0 ]; then
  echo -e "  ${RED}Done with errors. $deploy_errors deploy failure(s).${RESET}"
  exit 2
elif [ ${#unknown[@]} -gt 0 ]; then
  echo -e "  ${YELLOW}Done. ${#unknown[@]} unknown file(s) skipped — review warnings above.${RESET}"
  exit 1
else
  echo -e "  ${GREEN}All files deployed successfully.${RESET}"
  exit 0
fi
