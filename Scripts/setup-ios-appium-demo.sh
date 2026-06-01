#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"

check_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

echo "Checking local environment..."
check_command xcodebuild
check_command xcrun
check_command node
check_command npm

echo "Xcode: $(xcodebuild -version | tr '\n' ' ' | sed 's/  */ /g')"
echo "Developer path: $(xcode-select -p)"
echo "Node: $(node -v)"
echo "npm: $(npm -v)"

mkdir -p "$APPIUM_HOME"

echo "Installing demo dependencies..."
(cd "$DEMO_DIR" && npm install)

if [[ ! -d "$APPIUM_HOME/node_modules/appium-xcuitest-driver" ]]; then
  echo "Installing Appium XCUITest driver..."
  (
    cd "$DEMO_DIR"
    APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver install xcuitest
  )
else
  echo "Appium XCUITest driver already exists, skipping."
fi

echo
echo "Setup complete."
echo "Next step:"
echo "  $ROOT_DIR/Scripts/run-ios-appium-smoke.sh"
