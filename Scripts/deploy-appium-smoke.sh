#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$ROOT_DIR/demo/appium-smoke}"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"
INSTALL_MODE="${INSTALL_MODE:-ci}"
SKIP_NPM_INSTALL="${SKIP_NPM_INSTALL:-0}"
SKIP_APPIUM_DRIVER="${SKIP_APPIUM_DRIVER:-0}"

check_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

print_step() {
  echo
  echo "==> $1"
}

if [[ ! -d "$DEMO_DIR" ]]; then
  echo "Demo directory does not exist: $DEMO_DIR" >&2
  exit 1
fi

print_step "Checking local environment"
check_command xcodebuild
check_command xcrun
check_command node
check_command npm

echo "Xcode: $(xcodebuild -version | tr '\n' ' ' | sed 's/  */ /g')"
echo "Developer path: $(xcode-select -p)"
echo "Node: $(node -v)"
echo "npm: $(npm -v)"

print_step "Creating runtime directories"
mkdir -p \
  "$APPIUM_HOME" \
  "$DEMO_DIR/artifacts" \
  "$DEMO_DIR/artifacts/case-runs" \
  "$DEMO_DIR/artifacts/ui-check" \
  "$DEMO_DIR/case-data/uploads" \
  "$DEMO_DIR/logs" \
  "$DEMO_DIR/prebuilt-wda"

echo "APPIUM_HOME=$APPIUM_HOME"
echo "Artifacts=$DEMO_DIR/artifacts"
echo "Logs=$DEMO_DIR/logs"

if [[ "$SKIP_NPM_INSTALL" != "1" ]]; then
  print_step "Installing Node dependencies"
  if [[ "$INSTALL_MODE" == "install" || ! -f "$DEMO_DIR/package-lock.json" ]]; then
    (cd "$DEMO_DIR" && npm install)
  else
    (cd "$DEMO_DIR" && npm ci)
  fi
else
  print_step "Skipping Node dependency install"
fi

if [[ ! -x "$DEMO_DIR/node_modules/.bin/appium" ]]; then
  echo "Appium binary is missing after npm install: $DEMO_DIR/node_modules/.bin/appium" >&2
  exit 1
fi

if [[ "$SKIP_APPIUM_DRIVER" != "1" ]]; then
  print_step "Installing Appium XCUITest driver"
  if [[ -d "$APPIUM_HOME/node_modules/appium-xcuitest-driver" ]]; then
    echo "Appium XCUITest driver already exists, skipping."
  else
    (
      cd "$DEMO_DIR"
      APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver install xcuitest
    )
  fi
else
  print_step "Skipping Appium driver install"
fi

print_step "Validating case action templates"
(cd "$DEMO_DIR" && npm run cases:validate-actions)

cat <<EOF

Deploy complete.

Generated locally:
  - $DEMO_DIR/node_modules
  - $APPIUM_HOME
  - $DEMO_DIR/artifacts
  - $DEMO_DIR/logs
  - $DEMO_DIR/prebuilt-wda

Start real-device admin:
  DEVICE_NAME="iPhone t" \\
  DEVICE_UDID=00008020-001139E82292002E \\
  DEVICE_OS=18.7.8 \\
  XCODE_ORG_ID=H7DVXY862C \\
  UPDATED_WDA_BUNDLE_ID=com.zhaorui.WebDriverAgentRunner.ios.1 \\
  ./Scripts/run-case-admin-real-device.sh

Or use the simulator smoke script:
  ./Scripts/run-ios-appium-smoke.sh
EOF
