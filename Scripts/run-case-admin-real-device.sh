#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"
APPIUM_PORT="${APPIUM_PORT:-4723}"
APPIUM_BASE_URL="${APPIUM_BASE_URL:-http://127.0.0.1:${APPIUM_PORT}}"

DEVICE_NAME="${DEVICE_NAME:-iPhone good}"
DEVICE_UDID="${DEVICE_UDID:-00008020-000629C601E8003A}"
DEVICE_OS="${DEVICE_OS:-18.1.1}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.hunantv.imgotv}"
APP_NAME="${APP_NAME:-芒果TV}"
XCODE_ORG_ID="${XCODE_ORG_ID:-H7DVXY862C}"
XCODE_SIGNING_ID="${XCODE_SIGNING_ID:-Apple Development}"
UPDATED_WDA_BUNDLE_ID="${UPDATED_WDA_BUNDLE_ID:-com.zhaorui.WebDriverAgentRunner.ios.1}"
WDA_LOCAL_PORT="${WDA_LOCAL_PORT:-8100}"
WDA_DERIVED_DATA_PATH="${WDA_DERIVED_DATA_PATH:-$ROOT_DIR/DerivedData/WDARealDevice}"
WDA_AGENT_PATH="${WDA_AGENT_PATH:-$ROOT_DIR/WebDriverAgent.xcodeproj}"
USE_NEW_WDA="${USE_NEW_WDA:-0}"
USE_PREINSTALLED_WDA="${USE_PREINSTALLED_WDA:-0}"

export TARGET=real-device
export DEVICE_NAME DEVICE_UDID DEVICE_OS APP_BUNDLE_ID APP_NAME
export XCODE_ORG_ID XCODE_SIGNING_ID UPDATED_WDA_BUNDLE_ID
export WDA_LOCAL_PORT WDA_DERIVED_DATA_PATH WDA_AGENT_PATH
export APPIUM_HOME APPIUM_BASE_URL USE_NEW_WDA USE_PREINSTALLED_WDA

if [[ ! -x "$DEMO_DIR/node_modules/.bin/appium" ]]; then
  echo "Appium demo dependencies are missing. Run ./Scripts/setup-ios-appium-demo.sh first." >&2
  exit 1
fi

mkdir -p "$DEMO_DIR/logs"

if ! curl -fsS "$APPIUM_BASE_URL/status" >/dev/null 2>&1; then
  echo "Starting Appium at $APPIUM_BASE_URL ..."
  (
    cd "$DEMO_DIR"
    APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium --port "$APPIUM_PORT" --base-path /
  ) >"$DEMO_DIR/logs/appium-admin-real-device.log" 2>&1 &
fi

echo "Starting case admin for $DEVICE_NAME ($DEVICE_UDID) ..."
echo "USE_NEW_WDA=$USE_NEW_WDA, USE_PREINSTALLED_WDA=$USE_PREINSTALLED_WDA"
cd "$DEMO_DIR"
npm run cases:admin
