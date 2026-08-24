#!/usr/bin/env bash
#
# Association-file verification.
#
# Every check here guards a failure mode that is SILENT in production: when one
# of these is wrong, links simply open the browser instead of the app, which is
# indistinguishable from "the app is not installed". There is no error anywhere
# — not in Xcode, not in logcat, not in the server log.
#
# Run against the public host, not localhost: TLS, redirects and proxy rewrites
# are exactly what this is checking, and none of them exist locally.
#
#   ./scripts/verify.sh https://link-poc.example.com
#
# Intended to become the CI gate described in the migration requirements.

set -uo pipefail

HOST_URL="${1:-}"
if [[ -z "$HOST_URL" ]]; then
  HOST_URL="https://$(grep -E '^LINK_HOST=' .env 2>/dev/null | cut -d= -f2)"
fi
HOST_URL="${HOST_URL%/}"
HOST="${HOST_URL#https://}"
HOST="${HOST#http://}"

AASA_URL="$HOST_URL/.well-known/apple-app-site-association"
AL_URL="$HOST_URL/.well-known/assetlinks.json"

FAILED=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=$((FAILED + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1"; exit 2; }
}
need curl
need jq

echo
echo "Verifying $HOST_URL"
echo

# ── Serving requirements ────────────────────────────────────────────────────
# Deliberately NOT using -L: a redirect must be observed, not followed. Apple
# and Android both treat any redirect on these paths as a hard failure, and
# that includes a trailing-slash 301 added by a proxy.

check_wellknown() {
  local label="$1" url="$2"
  echo "$label"

  local out status redirects ctype
  out=$(curl -sS -o /tmp/.verify_body -w '%{http_code} %{num_redirects} %{content_type}' "$url" 2>/dev/null)
  if [[ -z "$out" ]]; then
    fail "unreachable: $url"
    return
  fi

  status=$(echo "$out" | awk '{print $1}')
  redirects=$(echo "$out" | awk '{print $2}')
  ctype=$(echo "$out" | awk '{print $3}')

  [[ "$status" == "200" ]] && pass "HTTP 200" || fail "HTTP $status (expected 200)"
  [[ "$redirects" == "0" ]] && pass "zero redirects" \
    || fail "$redirects redirect(s) — Apple and Android both reject ANY redirect here"
  [[ "$ctype" == application/json* ]] && pass "Content-Type: $ctype" \
    || fail "Content-Type: ${ctype:-none} (expected application/json)"

  if jq -e . /tmp/.verify_body >/dev/null 2>&1; then
    pass "valid JSON"
  else
    fail "response body is not valid JSON"
    return
  fi

  # Catches an empty-file deploy, which otherwise looks completely healthy.
  local count
  if [[ "$label" == *"assetlinks"* ]]; then
    count=$(jq 'length' /tmp/.verify_body)
  else
    count=$(jq '.applinks.details | length' /tmp/.verify_body)
  fi
  [[ "$count" -gt 0 ]] && pass "$count entr$([[ "$count" == 1 ]] && echo y || echo ies)" \
    || fail "file is empty — deep linking is down for every app"

  echo
}

check_wellknown "apple-app-site-association" "$AASA_URL"
check_wellknown "assetlinks.json" "$AL_URL"

# ── AASA must not have a .json extension in the canonical path ──────────────
echo "AASA filename"
if curl -sS -o /dev/null -w '%{http_code}' "$AASA_URL" | grep -q '^200$'; then
  pass "served extensionless at /.well-known/apple-app-site-association"
else
  fail "extensionless path does not return 200"
fi
echo

# ── Size against Apple's hard limit ─────────────────────────────────────────
echo "AASA size"
AASA_BYTES=$(curl -sS "$AASA_URL" | wc -c | tr -d ' ')
LIMIT=$((128 * 1024))
WARN=$((100 * 1024))
printf '  %s bytes (%.1f KB)\n' "$AASA_BYTES" "$(echo "$AASA_BYTES" | awk '{print $1/1024}')"
if [[ "$AASA_BYTES" -gt "$LIMIT" ]]; then
  fail "over Apple's 128 KB hard limit — Universal Links will silently stop working"
elif [[ "$AASA_BYTES" -gt "$WARN" ]]; then
  warn "over the 100 KB warning threshold — plan a second link host"
else
  pass "within limits"
fi
echo

# ── Fingerprint sanity ──────────────────────────────────────────────────────
echo "assetlinks fingerprints"
curl -sS "$AL_URL" | jq -r '.[] | "\(.target.package_name) \(.target.sha256_cert_fingerprints | length)"' |
  while read -r pkg n; do
    if [[ "$n" -eq 0 ]]; then
      fail "$pkg has no fingerprints"
    elif [[ "$n" -eq 1 ]]; then
      warn "$pkg has 1 fingerprint — include BOTH the upload key and the Play signing key"
    else
      pass "$pkg has $n fingerprints"
    fi
  done
echo

# ── Apple CDN propagation ───────────────────────────────────────────────────
# Apple serves the AASA through its own CDN with no manual invalidation. A
# tenant added on release day can have links open Safari for days — which is
# why entries go live at flavor-creation time, not at app release.
echo "Apple CDN (app-site-association.cdn-apple.com)"
CDN=$(curl -sS "https://app-site-association.cdn-apple.com/a/v1/$HOST" 2>/dev/null)
if echo "$CDN" | jq -e '.applinks.details' >/dev/null 2>&1; then
  CDN_N=$(echo "$CDN" | jq '.applinks.details | length')
  pass "CDN has the file with $CDN_N entr$([[ "$CDN_N" == 1 ]] && echo y || echo ies)"
  echo "$CDN" | jq -r '.applinks.details[].appIDs[]' | sed 's/^/      /'
else
  warn "not on Apple's CDN yet — propagation takes time after first publish"
  warn "for on-device testing use  applinks:$HOST?mode=developer  (strip before submission)"
fi
echo

# ── Summary ─────────────────────────────────────────────────────────────────
if [[ "$FAILED" -gt 0 ]]; then
  printf '\033[31m%s check(s) failed\033[0m\n\n' "$FAILED"
  exit 1
fi
printf '\033[32mAll checks passed\033[0m\n\n'

cat <<EOF
On-device verification (cannot be done from CI):

  Android — must print "verified"
    adb shell pm get-app-links <package>
    adb shell pm verify-app-links --re-verify <package>
    adb shell am start -a android.intent.action.VIEW -d "$HOST_URL/app/kennel/home"

  iOS — the simulator does not exercise the real AASA path; confirm on a device
    xcrun simctl openurl booted "$HOST_URL/app/kennel/home"
EOF
