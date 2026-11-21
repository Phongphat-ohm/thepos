#!/bin/sh
set -eu
umask 077
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${BACKUP_RECIPIENT:?Set BACKUP_RECIPIENT}"
directory=${BACKUP_DIR:-/backups}
work=$(mktemp -d)
archive=
trap 'rm -f -- "$work/pgpass" "$work/dump.err"; rmdir -- "$work"; [ -z "$archive" ] || rm -f -- "$archive"' EXIT
trap 'exit 1' HUP INT TERM

. /usr/local/lib/thepos-pg-uri.sh

DB_CONN=$(strip_uri_password "$DATABASE_URL" "$work/pgpass")
if [ -f "$work/pgpass" ]; then
  export PGPASSFILE="$work/pgpass"
fi
archive=$(mktemp "$directory/.pending.XXXXXXXX")
{
  if ! pg_dump --dbname="$DB_CONN" --format=custom --no-owner --no-privileges; then
    touch "$work/dump.err"
  fi
} | gpg --batch --yes --trust-model always --recipient "$BACKUP_RECIPIENT" --output "$archive" --encrypt
[ ! -f "$work/dump.err" ] || { echo "pg_dump failed." >&2; exit 1; }
file="$directory/thepos-$(date -u +%Y%m%dT%H%M%SZ)-${archive##*.}.dump.gpg"
mv -- "$archive" "$file"
archive=
retention=${BACKUP_RETENTION_DAYS:-30}
case "$retention" in ''|*[!0-9]*) retention=30;; esac
if [ "$retention" -gt 0 ]; then
  find "$directory" -maxdepth 1 -type f -name 'thepos-*.dump.gpg' -mtime +"$retention" -delete || true
fi
printf '%s\n' "$file"
