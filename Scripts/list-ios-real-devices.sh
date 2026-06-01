#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"

if [[ ! -x "$DEMO_DIR/node_modules/.bin/appium" ]]; then
  echo "Appium demo dependencies are missing. Run ./Scripts/setup-ios-appium-demo.sh first." >&2
  exit 1
fi

echo "Connected devices reported by Xcode:"
xcrun xctrace list devices | sed -n '/^== Devices ==$/,/^== /p' | sed '$d'

echo
echo "USB devices visible to Appium/usbmux:"
(
  cd "$DEMO_DIR"
  APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver run xcuitest list-real-devices
)
