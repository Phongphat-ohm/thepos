#!/bin/sh
set -eu
umask 077
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a new empty database}"
[ "${1:-}" ] && [ -f "$1" ] && [ -r "$1" ] || { echo "Usage: restore.sh path/to/backup.dump.gpg" >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -f -- "$work/pgpass" "$work/restore.err"; rmdir -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

strip_uri_password() {
  raw_url=$1
  passfile=$2
  clean_url=$raw_url
  case "$raw_url" in
    postgres://*:*@*|postgresql://*:*@*)
      scheme=${raw_url%%://*}
      after_scheme=${raw_url#*://}
      authority=${after_scheme%%[/?#]*}
      case "$authority" in
        *@*)
          userinfo=${authority%@*}
          hostport=${authority##*@}
          case "$userinfo" in
            *:*)
              user=${userinfo%%:*}
              enc_pass=${userinfo#*:}
              suffix=${after_scheme#"$authority"}
              dec_pass=$(printf '%s' "$enc_pass" | awk '{
                out = ""
                for (i = 1; i <= length($0); i++) {
                  ch = substr($0, i, 1)
                  if (ch == "%" && i + 2 <= length($0) && substr($0, i + 1, 2) ~ /^[0-9A-Fa-f]{2}$/) {
                    out = out sprintf("%c", strtonum("0x" substr($0, i + 1, 2)))
                    i += 2
                  } else {
                    out = out ch
                  }
                }
                gsub(/\\/, "\\\\", out)
                gsub(/:/, "\\:", out)
                printf "%s", out
              }')
              printf '*:*:*:*:%s\n' "$dec_pass" > "$passfile"
              chmod 600 "$passfile"
              export PGPASSFILE="$passfile"
              clean_url="${scheme}://${user}@${hostport}${suffix}"
              ;;
          esac
          ;;
      esac
      ;;
  esac
  printf '%s' "$clean_url"
}

RESTORE_CONN=$(strip_uri_password "$RESTORE_DATABASE_URL" "$work/pgpass")
tables=$(psql "$RESTORE_CONN" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")
[ "$tables" = 0 ] || { echo "Restore destination already has user tables." >&2; exit 2; }
{
  if ! gpg --batch --decrypt "$1"; then
    touch "$work/restore.err"
  fi
} | pg_restore --dbname="$RESTORE_CONN" --single-transaction --exit-on-error --no-owner --no-privileges
[ ! -f "$work/restore.err" ] || { echo "gpg decrypt failed." >&2; exit 1; }
