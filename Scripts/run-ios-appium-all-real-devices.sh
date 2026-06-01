#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ONE="$ROOT_DIR/Scripts/run-ios-appium-real-device.sh"

if [[ ! -x "$RUN_ONE" ]]; then
  echo "Missing executable script: $RUN_ONE" >&2
  exit 1
fi

CONNECTED_JSON="$(
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

if [[ "$CONNECTED_JSON" == "[]" ]]; then
  echo "No connected real devices were found by Xcode." >&2
  exit 1
fi

mapfile -t TARGETS < <(
  printf '%s' "$CONNECTED_JSON" | node -e '
    const fs = require("fs");
    const requested = new Set(
      (process.env.DEVICE_UDIDS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    );
    const devices = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const device of devices) {
      if (requested.size > 0 && !requested.has(device.udid)) {
        continue;
      }
      process.stdout.write(`${device.udid}\t${device.name}\t${device.os}\n`);
    }
  '
)

if [[ "${#TARGETS[@]}" -eq 0 ]]; then
  echo "No matching connected devices were selected. Check DEVICE_UDIDS or run ./Scripts/list-ios-real-devices.sh." >&2
  exit 1
fi

for target in "${TARGETS[@]}"; do
  IFS=$'\t' read -r device_udid device_name device_os <<<"$target"
  echo
  echo "=== Running smoke test on ${device_name} (${device_os}) [${device_udid}] ==="
  DEVICE_UDID="$device_udid" \
  DEVICE_NAME="$device_name" \
  DEVICE_OS="$device_os" \
  "$RUN_ONE"
done
