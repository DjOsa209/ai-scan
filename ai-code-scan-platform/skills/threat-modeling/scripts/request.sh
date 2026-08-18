#!/bin/sh
set -eu
: "${SECURITY_PLATFORM_URL:?SECURITY_PLATFORM_URL is required}"
: "${SECURITY_PLATFORM_API_KEY:?SECURITY_PLATFORM_API_KEY is required}"
method="${1:-GET}"
resource="${2:-/}"
body="${3:-}"
case "$resource" in /*) ;; *) echo "resource must start with /" >&2; exit 2 ;; esac
case "$resource" in *..*) echo "resource must not contain .." >&2; exit 2 ;; esac
set -- -fsS -X "$method" -H "Authorization: Bearer $SECURITY_PLATFORM_API_KEY" -H "Accept: application/json"
if [ -n "$body" ]; then set -- "$@" -H "Content-Type: application/json" --data "$body"; fi
curl "$@" "${SECURITY_PLATFORM_URL%/}/api/v1/threat-models$resource"