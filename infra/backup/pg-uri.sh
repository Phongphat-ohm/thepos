#!/bin/sh
# Shared PostgreSQL URI password extractor compatible with POSIX awk/mawk.
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
              dec_pass=$(printf '%s' "$enc_pass" | awk '
                function hexval(ch,    pos) {
                  pos = index("0123456789ABCDEF", toupper(ch))
                  return pos > 0 ? pos - 1 : -1
                }
                {
                  out = ""
                  for (i = 1; i <= length($0); i++) {
                    ch = substr($0, i, 1)
                    if (ch == "%" && i + 2 <= length($0)) {
                      hi = hexval(substr($0, i + 1, 1))
                      lo = hexval(substr($0, i + 2, 1))
                      if (hi >= 0 && lo >= 0) {
                        out = out sprintf("%c", hi * 16 + lo)
                        i += 2
                        continue
                      }
                    }
                    out = out ch
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
