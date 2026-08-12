#!/bin/bash
# backup-data.sh — Daily backup of journal and bike data files
#
# Backs up /home/shyguy/apps/data/ to the external drive.
# Run daily at 4am via cron. Retains backups for 30 days.
#
# Cron entry (run: crontab -e):
#   0 4 * * * bash /home/shyguy/apps/backup-data.sh >> /home/shyguy/apps/backup-data.log 2>&1

SOURCE_DIR="/home/shyguy/apps/data"
BACKUP_DIR="/mnt/warehouse/backups/data"
RETAIN_DAYS=30
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
ARCHIVE="$BACKUP_DIR/data_$TIMESTAMP.tar.gz"

echo ""
echo "──────────────────────────────────────"
echo "  Data Backup — $(date '+%Y-%m-%d %H:%M')"
echo "──────────────────────────────────────"

# ── Preflight ─────────────────────────────────────────────────────
if [ ! -d "$SOURCE_DIR" ]; then
  echo "  ✗ Source not found: $SOURCE_DIR"
  exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  if [ $? -ne 0 ]; then
    echo "  ✗ Could not create backup dir: $BACKUP_DIR"
    echo "    Is the external drive mounted?"
    exit 1
  fi
  echo "  ✓ Created backup dir: $BACKUP_DIR"
fi

# ── Archive ───────────────────────────────────────────────────────
tar -czf "$ARCHIVE" -C "$(dirname "$SOURCE_DIR")" "$(basename "$SOURCE_DIR")"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$ARCHIVE" | cut -f1)
  echo "  ✓ Archive created: data_$TIMESTAMP.tar.gz ($SIZE)"
else
  echo "  ✗ Archive failed — check disk space and mount status"
  exit 1
fi

# ── Prune old backups ─────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "data_*.tar.gz" -mtime +$RETAIN_DAYS -print -delete 2>/dev/null | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "  ✓ Pruned $DELETED archive(s) older than $RETAIN_DAYS days"
else
  echo "  — No old archives to prune"
fi

# ── Summary ───────────────────────────────────────────────────────
TOTAL=$(find "$BACKUP_DIR" -name "data_*.tar.gz" | wc -l)
echo "  — $TOTAL archive(s) retained in $BACKUP_DIR"
echo "  Done."
