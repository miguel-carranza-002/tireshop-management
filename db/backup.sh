#!/bin/bash
# Back up the tire shop database: db/backup.sh [database]
# Defaults: database "tireshop", into ~/Backups/tireshop, keeping 30 days.
# Override with BACKUP_DB, BACKUP_DIR, BACKUP_KEEP_DAYS.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "$ROOT/apps/api/.env"; set +a
DB=${1:-${BACKUP_DB:-tireshop}}
DIR=${BACKUP_DIR:-$HOME/Backups/tireshop}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
PGBIN=${PGBIN:-/Library/PostgreSQL/18/bin}

mkdir -p "$DIR"
FILE="$DIR/${DB}_$(date +%Y-%m-%d_%H%M).dump"
# Write to a temporary name first so a failed dump never looks like a good one.
PGPASSWORD="$DB_PASSWORD" "$PGBIN/pg_dump" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
  --format=custom --file="$FILE.partial" "$DB"
mv "$FILE.partial" "$FILE"
find "$DIR" -name "${DB}_*.dump" -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backed up $DB to $FILE ($(du -h "$FILE" | cut -f1))"
