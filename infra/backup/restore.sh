#!/bin/sh
set -eu
umask 077
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a new empty database}"
[ "${1:-}" ] && [ -f "$1" ] && [ -r "$1" ] || { echo "Usage: restore.sh path/to/backup.dump.gpg" >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -f -- "$work/pgpass" "$work/restore.err"; rmdir -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

. /usr/local/lib/thepos-pg-uri.sh

RESTORE_CONN=$(strip_uri_password "$RESTORE_DATABASE_URL" "$work/pgpass")
if [ -f "$work/pgpass" ]; then
  export PGPASSFILE="$work/pgpass"
fi
tables=$(psql "$RESTORE_CONN" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")
[ "$tables" = 0 ] || { echo "Restore destination already has user tables." >&2; exit 2; }
{
  if ! gpg --batch --decrypt "$1"; then
    touch "$work/restore.err"
  fi
} | pg_restore --dbname="$RESTORE_CONN" --single-transaction --exit-on-error --no-owner --no-privileges
[ ! -f "$work/restore.err" ] || { echo "gpg decrypt failed." >&2; exit 1; }
