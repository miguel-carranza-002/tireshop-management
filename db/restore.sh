#!/bin/bash
# Restore a backup into a database: db/restore.sh <file.dump> <database>
# Restoring replaces everything in that database. To look at an old backup
# safely, restore it into a scratch database (e.g. tireshop_restore) first.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "$ROOT/apps/api/.env"; set +a
FILE=${1:?usage: db/restore.sh <file.dump> <database>}
DB=${2:?usage: db/restore.sh <file.dump> <database>}
PGBIN=${PGBIN:-/Library/PostgreSQL/18/bin}

read -r -p "Replace everything in database \"$DB\" with $FILE? Type the database name to confirm: " answer
[ "$answer" = "$DB" ] || { echo "Cancelled."; exit 1; }
PGPASSWORD="$DB_PASSWORD" "$PGBIN/pg_restore" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
  --dbname="$DB" --clean --if-exists --no-owner --single-transaction "$FILE"
echo "Restored $FILE into $DB."
