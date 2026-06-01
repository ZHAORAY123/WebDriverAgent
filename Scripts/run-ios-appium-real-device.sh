#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
LOG_DIR="$DEMO_DIR/logs"
ARTIFACT_DIR="$DEMO_DIR/artifacts"
APPIUM_HOME="${APPIUM_HOME:-$DEMO_DIR/.appium}"
PREPARE_PREBUILT_WDA_SCRIPT="$ROOT_DIR/Scripts/prepare-prebuilt-wda.sh"
TEST_ENTRY="${TEST_ENTRY:-./smoke-test.mjs}"
TEST_ARGS="${TEST_ARGS:-}"

DEVICE_NAME="${DEVICE_NAME:-Zhao的iPhone}"
DEVICE_UDID="${DEVICE_UDID:-}"
DEVICE_OS="${DEVICE_OS:-}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.hunantv.imgotv}"
APP_NAME="${APP_NAME:-芒果TV}"
XCODE_ORG_ID="${XCODE_ORG_ID:-}"
XCODE_SIGNING_ID="${XCODE_SIGNING_ID:-Apple Development}"
UPDATED_WDA_BUNDLE_ID="${UPDATED_WDA_BUNDLE_ID:-}"
ALLOW_PROVISIONING_DEVICE_REGISTRATION="${ALLOW_PROVISIONING_DEVICE_REGISTRATION:-1}"
USE_PREINSTALLED_WDA="${USE_PREINSTALLED_WDA:-0}"
USE_NEW_WDA="${USE_NEW_WDA:-0}"
PREBUILT_WDA_PATH="${PREBUILT_WDA_PATH:-}"
APPIUM_PORT="${APPIUM_PORT:-4723}"
WDA_LOCAL_PORT="${WDA_LOCAL_PORT:-8100}"
WDA_DERIVED_DATA_PATH="${WDA_DERIVED_DATA_PATH:-$ROOT_DIR/DerivedData/WDARealDevice}"
WDA_AGENT_PATH="${WDA_AGENT_PATH:-$ROOT_DIR/WebDriverAgent.xcodeproj}"
APPIUM_BASE_URL="http://127.0.0.1:${APPIUM_PORT}"

export DEVICE_NAME DEVICE_UDID DEVICE_OS XCODE_ORG_ID XCODE_SIGNING_ID
export UPDATED_WDA_BUNDLE_ID APPIUM_PORT WDA_LOCAL_PORT WDA_DERIVED_DATA_PATH
export WDA_AGENT_PATH APPIUM_HOME APPIUM_BASE_URL ALLOW_PROVISIONING_DEVICE_REGISTRATION
export USE_PREINSTALLED_WDA USE_NEW_WDA PREBUILT_WDA_PATH APP_BUNDLE_ID APP_NAME TEST_ENTRY TEST_ARGS

mkdir -p "$LOG_DIR" "$ARTIFACT_DIR" "$APPIUM_HOME"

ios_major_version() {
  local version="$1"
  printf '%s' "$version" | awk -F. '{print $1}'
}

cleanup() {
  if [[ -n "${APPIUM_PID:-}" ]] && kill -0 "$APPIUM_PID" >/dev/null 2>&1; then
    kill "$APPIUM_PID" >/dev/null 2>&1 || true
    wait "$APPIUM_PID" >/dev/null 2>&1 || true
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

ensure_inputs() {
  if [[ "$USE_PREINSTALLED_WDA" != "1" && -z "$XCODE_ORG_ID" ]]; then
    echo "Missing XCODE_ORG_ID. Example: XCODE_ORG_ID=YWGJ24C4MZ" >&2
    exit 1
  fi

  if [[ -z "$UPDATED_WDA_BUNDLE_ID" ]]; then
    echo "Missing UPDATED_WDA_BUNDLE_ID. Example: UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner" >&2
    exit 1
  fi
}

ensure_prebuilt_wda_path() {
  if [[ "$USE_PREINSTALLED_WDA" != "1" ]]; then
    return 0
  fi

  if [[ -z "$PREBUILT_WDA_PATH" ]]; then
    local ios_major
    ios_major="$(ios_major_version "$DEVICE_OS")"
    if [[ "$ios_major" -ge 17 ]]; then
      PREBUILT_WDA_PATH="$DEMO_DIR/prebuilt-wda/ios17plus/WebDriverAgentRunner-Runner.app"
    else
      PREBUILT_WDA_PATH="$DEMO_DIR/prebuilt-wda/ios13-16/WebDriverAgentRunner-Runner.app"
    fi
    export PREBUILT_WDA_PATH
  fi

  if [[ ! -d "$PREBUILT_WDA_PATH" ]]; then
    if [[ ! -x "$PREPARE_PREBUILT_WDA_SCRIPT" ]]; then
      echo "Missing prebuilt WDA helper: $PREPARE_PREBUILT_WDA_SCRIPT" >&2
      exit 1
    fi
    echo "Preparing prebuilt WDA at $PREBUILT_WDA_PATH ..."
    DEST_WDA_APP="$PREBUILT_WDA_PATH" \
    TARGET_IOS_VERSION="$DEVICE_OS" \
    STRIP_XCTEST_FRAMEWORKS="auto" \
    "$PREPARE_PREBUILT_WDA_SCRIPT"
  fi

  if [[ ! -d "$PREBUILT_WDA_PATH" ]]; then
    echo "PREBUILT_WDA_PATH does not exist: $PREBUILT_WDA_PATH" >&2
    exit 1
  fi
}

ensure_supported_ios_version() {
  if [[ -z "$DEVICE_OS" ]]; then
    echo "Could not determine iOS version for the target device." >&2
    exit 1
  fi

  local ios_major
  ios_major="$(ios_major_version "$DEVICE_OS")"
  if [[ "$ios_major" -lt 13 ]]; then
    echo "This setup currently supports iOS 13 and above. Current device version: $DEVICE_OS" >&2
    exit 1
  fi
}

find_device() {
  local connected_json
  connected_json="$(
    xcrun xctrace list devices | node -e '
      const fs = require("fs");
      const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
      const devices = [];
      let inConnected = false;
      for (const line of lines) {
        if (line === "== Devices ==") {
          inConnected = true;
          continue;
        }
        if (/^== /.test(line)) {
          if (inConnected) {
            break;
          }
          continue;
        }
        if (!inConnected) {
          continue;
        }
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("Ray的MacBook")) {
          continue;
        }
        const match = /^(.*) \(([^()]+)\) \(([0-9A-F-]+)\)$/.exec(trimmed);
        if (!match) {
          continue;
        }
        devices.push({
          name: match[1],
          os: match[2],
          udid: match[3],
        });
      }
      process.stdout.write(JSON.stringify(devices));
    '
  )"

  if [[ "$connected_json" == "[]" ]]; then
    echo "No connected real devices were found by Xcode. Run ./Scripts/list-ios-real-devices.sh to inspect the current state." >&2
    exit 1
  fi

  if [[ -n "$DEVICE_UDID" || -n "$DEVICE_NAME" || -z "$DEVICE_OS" ]]; then
    local resolved
    resolved="$(
      DEVICE_NAME="$DEVICE_NAME" DEVICE_UDID="$DEVICE_UDID" \
      printf '%s' "$connected_json" | node -e '
        const fs = require("fs");
        const devices = JSON.parse(fs.readFileSync(0, "utf8"));
        const udid = process.env.DEVICE_UDID;
        const name = process.env.DEVICE_NAME;
        let match = null;
        if (udid) {
          match = devices.find((device) => device.udid === udid) ?? null;
        } else if (name) {
          match = devices.find((device) => device.name === name) ?? null;
        } else {
          match = devices[0] ?? null;
        }
        if (!match) {
          process.exit(1);
        }
        process.stdout.write(JSON.stringify(match));
      '
    )" || {
      echo "The requested device is not currently connected. Run ./Scripts/list-ios-real-devices.sh and use a UDID that appears under both Xcode and Appium/usbmux." >&2
      exit 1
    }

    DEVICE_UDID="$(printf '%s' "$resolved" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).udid")"
    DEVICE_NAME="$(printf '%s' "$resolved" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).name")"
    DEVICE_OS="$(printf '%s' "$resolved" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).os")"
  fi

  export DEVICE_UDID DEVICE_OS

  if [[ -z "$DEVICE_UDID" || -z "$DEVICE_OS" ]]; then
    echo "Could not resolve a connected real device. Run ./Scripts/list-ios-real-devices.sh." >&2
    exit 1
  fi
}

ensure_demo_dependencies() {
  if [[ ! -x "$DEMO_DIR/node_modules/.bin/appium" ]]; then
    echo "Installing local Appium in $DEMO_DIR ..."
    (cd "$DEMO_DIR" && npm install)
  fi
}

ensure_xcuitest_driver() {
  if [[ ! -d "$APPIUM_HOME/node_modules/appium-xcuitest-driver" ]]; then
    echo "Installing Appium XCUITest driver ..."
    (cd "$DEMO_DIR" && APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver install xcuitest)
  fi
}

ensure_device_visible_to_appium() {
  local visible_json
  visible_json="$(
    cd "$DEMO_DIR"
    APPIUM_HOME="$APPIUM_HOME" ./node_modules/.bin/appium driver run --json xcuitest list-real-devices
  )"

  if ! DEVICE_UDID="$DEVICE_UDID" printf '%s' "$visible_json" | node -e '
    const fs = require("fs");
    const udid = process.env.DEVICE_UDID;
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const text = Array.isArray(payload.output) ? payload.output.join("\n") : "";
    process.exit(text.includes(`"udid": "${udid}"`) ? 0 : 1);
  '; then
    echo "Device $DEVICE_UDID is not visible to Appium/usbmux right now. Run ./Scripts/list-ios-real-devices.sh and reconnect the phone if needed." >&2
    exit 1
  fi
}

start_appium() {
  if curl -fsS "$APPIUM_BASE_URL/status" >/dev/null 2>&1; then
    echo "Reusing existing Appium at $APPIUM_BASE_URL"
    return 0
  fi

  local appium_log="$LOG_DIR/appium-real-device.log"
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
  echo "Running real-device test entry $TEST_ENTRY $TEST_ARGS for $APP_NAME ($APP_BUNDLE_ID) on $DEVICE_NAME ($DEVICE_OS) [$DEVICE_UDID] ..."
  (
    cd "$DEMO_DIR"
    local -a test_args_array=()
    if [[ -n "${TEST_ARGS:-}" ]]; then
      # shellcheck disable=SC2206
      test_args_array=($TEST_ARGS)
    fi
    export TARGET="real-device"
    export APPIUM_BASE_URL DEVICE_NAME DEVICE_UDID DEVICE_OS
    export XCODE_ORG_ID XCODE_SIGNING_ID UPDATED_WDA_BUNDLE_ID
    export WDA_LOCAL_PORT WDA_DERIVED_DATA_PATH WDA_AGENT_PATH
    export APP_BUNDLE_ID APP_NAME ARTIFACT_DIR
    if [[ ${#test_args_array[@]} -gt 0 ]]; then
      node "$TEST_ENTRY" "${test_args_array[@]}"
    else
      node "$TEST_ENTRY"
    fi
  )
}

trap cleanup EXIT

ensure_inputs
find_device
ensure_supported_ios_version
ensure_prebuilt_wda_path
ensure_demo_dependencies
ensure_xcuitest_driver
ensure_device_visible_to_appium
start_appium
run_smoke_test

echo "Done. Logs: $LOG_DIR"
echo "Artifacts: $ARTIFACT_DIR"
