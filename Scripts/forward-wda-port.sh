#!/bin/bash

set -euo pipefail

DEVICE_UDID="${1:-${DEVICE_UDID:-}}"
LOCAL_PORT="${LOCAL_PORT:-8100}"
REMOTE_PORT="${REMOTE_PORT:-8100}"

if [[ -z "$DEVICE_UDID" ]]; then
  echo "Missing DEVICE_UDID. Usage: $0 <device-udid>"
  exit 1
fi

if ! command -v iproxy >/dev/null 2>&1; then
  echo "iproxy is not installed yet. Install libimobiledevice first."
  exit 1
fi

echo "Forwarding localhost:$LOCAL_PORT -> device:$REMOTE_PORT for $DEVICE_UDID"
exec iproxy -u "$DEVICE_UDID" "$LOCAL_PORT:$REMOTE_PORT"
