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

DB_CONN=$(strip_uri_password "$DATABASE_URL" "$work/pgpass")
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
