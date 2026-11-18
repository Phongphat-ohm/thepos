#!/bin/sh
set -eu
umask 077
interval=${BACKUP_INTERVAL_SECONDS:-86400}
case "$interval" in ''|*[!0-9]*) exit 2;; esac
[ "$interval" -gt 0 ] || exit 2
export GNUPGHOME
GNUPGHOME=$(mktemp -d)
trap 'rm -rf -- "$GNUPGHOME"; exit 0' HUP INT TERM EXIT
gpg --batch --import /keys/recipient.asc
until backup.sh; do
  echo "Backup failed. Retrying in 60 seconds." >&2
  sleep 60 &
  wait $! || exit 0
done
while true; do
  sleep "$interval" &
  wait $! || break
  backup.sh || echo "Scheduled backup failed." >&2
done
