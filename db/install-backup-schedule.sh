#!/bin/bash
# Schedule db/backup.sh nightly with launchd (runs at 11:30 pm while you're logged in;
# if the Mac was asleep, it runs when it wakes). Remove with:
#   launchctl bootout gui/$(id -u)/com.tireshop.backup && rm ~/Library/LaunchAgents/com.tireshop.backup.plist
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${BACKUP_DIR:-$HOME/Backups/tireshop}
PLIST="$HOME/Library/LaunchAgents/com.tireshop.backup.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
sed -e "s#__REPO__#$ROOT#g" -e "s#__BACKUP_DIR__#$DIR#g" "$ROOT/db/launchd/com.tireshop.backup.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.tireshop.backup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Nightly backup scheduled. Backups and backup.log go to $DIR"
