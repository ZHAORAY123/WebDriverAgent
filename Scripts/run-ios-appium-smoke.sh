#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
LOG_DIR="$DEMO_DIR/logs"
ARTIFACT_DIR="$DEMO_DIR/artifacts"
TEST_ENTRY="${TEST_ENTRY:-./smoke-test.mjs}"
TEST_ARGS="${TEST_ARGS:-}"

SIM_NAME="${SIM_NAME:-iPhone 17}"
SIM_OS="${SIM_OS:-26.2}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.hunantv.imgotv}"
APP_NAME="${APP_NAME:-芒果TV}"
WDA_PORT="${WDA_PORT:-8100}"
APPIUM_PORT="${APPIUM_PORT:-4723}"
WDA_BASE_URL="http://127.0.0.1:${WDA_PORT}"
APPIUM_BASE_URL="http://127.0.0.1:${APPIUM_PORT}"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"

export SIM_NAME SIM_OS APP_BUNDLE_ID APP_NAME WDA_PORT APPIUM_PORT WDA_BASE_URL APPIUM_BASE_URL APPIUM_HOME TEST_ENTRY TEST_ARGS

mkdir -p "$LOG_DIR" "$ARTIFACT_DIR" "$APPIUM_HOME"

cleanup() {
  if [[ -n "${APPIUM_PID:-}" ]] && kill -0 "$APPIUM_PID" >/dev/null 2>&1; then
    kill "$APPIUM_PID" >/dev/null 2>&1 || true
    wait "$APPIUM_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WDA_PID:-}" ]] && kill -0 "$WDA_PID" >/dev/null 2>&1; then
    kill "$WDA_PID" >/dev/null 2>&1 || true
    wait "$WDA_PID" >/dev/null 2>&1 || true
  fi
}

wait_for_http() {
  local url="$1"
  local timeout_secs="$2"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start_ts >= timeout_secs )); then
      return 1
    fi
    sleep 2
  done
}

find_simulator() {
  SIM_UDID="$(
    xcrun simctl list devices available -j | node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(0, 'utf8'));
      const preferredName = process.env.SIM_NAME;
      const preferredOs = process.env.SIM_OS;
      const runtimes = Object.entries(data.devices);
      const flatten = runtimes.flatMap(([runtime, devices]) =>
        devices
          .filter((device) => device.isAvailable && device.name.includes('iPhone'))
          .map((device) => ({runtime, ...device}))
      );
      const preferred = flatten.find((device) =>
        device.name === preferredName && device.runtime.includes(preferredOs)
      );
      const fallback = flatten[0];
      const match = preferred ?? fallback;
      if (!match) {
        process.exit(1);
      }
      process.stdout.write(match.udid);
    "
  )"

  if [[ -z "$SIM_UDID" ]]; then
    echo "No available iPhone simulator was found." >&2
    exit 1
  fi

  export SIM_UDID

  SIM_RUNTIME="$(
    xcrun simctl list devices available -j | node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(0, 'utf8'));
      const udid = process.env.SIM_UDID;
      for (const [runtime, devices] of Object.entries(data.devices)) {
        const match = devices.find((device) => device.udid === udid);
        if (match) {
          process.stdout.write(runtime.replace(/^com\\.apple\\.CoreSimulator\\.SimRuntime\\.iOS-/, '').replace(/-/g, '.'));
          process.exit(0);
        }
      }
      process.exit(1);
    "
  )"
}

ensure_demo_dependencies() {
  if [[ ! -x "$DEMO_DIR/node_modules/.bin/appium" ]]; then
    echo "Installing local Appium in $DEMO_DIR ..."
    (cd "$DEMO_DIR" && npm install appium)
  fi
}

ensure_xcuitest_driver() {
  if [[ ! -d "$APPIUM_HOME/node_modules/appium-xcuitest-driver" ]]; then
    echo "Installing Appium XCUITest driver ..."
    (cd "$DEMO_DIR" && APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver install xcuitest)
  fi
}

start_simulator() {
  echo "Booting simulator $SIM_NAME (${SIM_RUNTIME}) [$SIM_UDID] ..."
  xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
  open -a Simulator --args -CurrentDeviceUDID "$SIM_UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$SIM_UDID" -b
}

start_wda() {
  if curl -fsS "$WDA_BASE_URL/status" >/dev/null 2>&1; then
    echo "Reusing existing WebDriverAgent at $WDA_BASE_URL"
    return 0
  fi

  local wda_log="$LOG_DIR/wda.log"
  echo "Starting WebDriverAgent ..."
  (
    cd "$ROOT_DIR"
    xcodebuild test \
      -project WebDriverAgent.xcodeproj \
      -scheme WebDriverAgentRunner \
      -destination "id=$SIM_UDID" \
      -derivedDataPath DerivedData/WDA-Sim
  ) >"$wda_log" 2>&1 &
  WDA_PID=$!

  if ! wait_for_http "$WDA_BASE_URL/status" 120; then
    echo "WebDriverAgent did not become ready. Log: $wda_log" >&2
    exit 1
  fi

  echo "WebDriverAgent is ready. Log: $wda_log"
}

start_appium() {
  if curl -fsS "$APPIUM_BASE_URL/status" >/dev/null 2>&1; then
    echo "Reusing existing Appium at $APPIUM_BASE_URL"
    return 0
  fi

  local appium_log="$LOG_DIR/appium.log"
  echo "Starting Appium ..."
  (
    cd "$DEMO_DIR"
    APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium --port "$APPIUM_PORT" --base-path /
  ) >"$appium_log" 2>&1 &
  APPIUM_PID=$!

  if ! wait_for_http "$APPIUM_BASE_URL/status" 60; then
    echo "Appium did not become ready. Log: $appium_log" >&2
    exit 1
  fi

  echo "Appium is ready. Log: $appium_log"
}

run_smoke_test() {
  echo "Running test entry $TEST_ENTRY $TEST_ARGS for $APP_NAME ($APP_BUNDLE_ID) ..."
  (
    cd "$DEMO_DIR"
    # shellcheck disable=SC2206
    local test_args_array=($TEST_ARGS)
    APPIUM_BASE_URL="$APPIUM_BASE_URL" \
    WDA_BASE_URL="$WDA_BASE_URL" \
    SIM_NAME="$SIM_NAME" \
    SIM_OS="$SIM_RUNTIME" \
    SIM_UDID="$SIM_UDID" \
    APP_BUNDLE_ID="$APP_BUNDLE_ID" \
    APP_NAME="$APP_NAME" \
    ARTIFACT_DIR="$ARTIFACT_DIR" \
    node "$TEST_ENTRY" "${test_args_array[@]}"
  )
}

trap cleanup EXIT

find_simulator
ensure_demo_dependencies
ensure_xcuitest_driver
start_simulator
start_wda
start_appium
run_smoke_test

echo "Done. Logs: $LOG_DIR"
echo "Artifacts: $ARTIFACT_DIR"
