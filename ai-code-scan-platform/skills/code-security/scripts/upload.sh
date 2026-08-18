#!/bin/sh
set -eu
: "${SECURITY_PLATFORM_URL:?SECURITY_PLATFORM_URL is required}"
: "${SECURITY_PLATFORM_API_KEY:?SECURITY_PLATFORM_API_KEY is required}"
archive="${1:?archive path is required}"
[ -f "$archive" ] || { echo "archive not found" >&2; exit 2; }
curl -fsS -X POST -H "Authorization: Bearer $SECURITY_PLATFORM_API_KEY" -H "Accept: application/json" -F "archive=@$archive;type=application/zip" "${SECURITY_PLATFORM_URL%/}/api/v1/code-scans/archive"