#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$ROOT_DIR/DerivedData/WDARealDevice}"
TEAM_ID="${TEAM_ID:-}"
BUNDLE_ID="${BUNDLE_ID:-}"
DEVICE_UDID="${DEVICE_UDID:-}"
SCHEME="${SCHEME:-WebDriverAgentRunner}"
CONFIGURATION="${CONFIGURATION:-Debug}"

if [[ -z "$TEAM_ID" ]]; then
  echo "Missing TEAM_ID. Example: TEAM_ID=YWGJ24C4MZ"
  exit 1
fi

if [[ -z "$BUNDLE_ID" ]]; then
  echo "Missing BUNDLE_ID. Example: BUNDLE_ID=com.example.WebDriverAgentRunner"
  exit 1
fi

if [[ -z "$DEVICE_UDID" ]]; then
  echo "Missing DEVICE_UDID. Example: DEVICE_UDID=00008101-00195C920268001E"
  exit 1
fi

echo "Starting WebDriverAgent on device:"
echo "  TEAM_ID=$TEAM_ID"
echo "  BUNDLE_ID=$BUNDLE_ID"
echo "  DEVICE_UDID=$DEVICE_UDID"
echo "  DERIVED_DATA_PATH=$DERIVED_DATA_PATH"

cd "$ROOT_DIR"

xcodebuild \
  clean test \
  -project WebDriverAgent.xcodeproj \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "id=$DEVICE_UDID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
