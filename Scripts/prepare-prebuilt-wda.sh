#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo/appium-smoke"
PREBUILT_DIR="$DEMO_DIR/prebuilt-wda"

SOURCE_WDA_APP="${SOURCE_WDA_APP:-}"
DEST_WDA_APP="${DEST_WDA_APP:-$PREBUILT_DIR/WebDriverAgentRunner-Runner.app}"
TARGET_IOS_VERSION="${TARGET_IOS_VERSION:-}"
STRIP_XCTEST_FRAMEWORKS="${STRIP_XCTEST_FRAMEWORKS:-auto}"

ios_major_version() {
  local version="$1"
  printf '%s' "$version" | awk -F. '{print $1}'
}

find_source_app() {
  if [[ -n "$SOURCE_WDA_APP" ]]; then
    return 0
  fi

  SOURCE_WDA_APP="$(
    find "$HOME/Library/Developer/Xcode/DerivedData" \
      -path '*/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app' \
      -print | grep -v '/Index.noindex/' | sort | tail -n 1
  )"

  if [[ -z "$SOURCE_WDA_APP" ]]; then
    echo "Could not find a Debug-iphoneos WebDriverAgentRunner-Runner.app in DerivedData." >&2
    exit 1
  fi
}

should_strip_runner_frameworks() {
  case "$STRIP_XCTEST_FRAMEWORKS" in
    1|true|yes)
      return 0
      ;;
    0|false|no)
      return 1
      ;;
    auto)
      if [[ -z "$TARGET_IOS_VERSION" ]]; then
        return 0
      fi
      if [[ "$(ios_major_version "$TARGET_IOS_VERSION")" -ge 17 ]]; then
        return 0
      fi
      return 1
      ;;
    *)
      echo "Unsupported STRIP_XCTEST_FRAMEWORKS value: $STRIP_XCTEST_FRAMEWORKS" >&2
      exit 1
      ;;
  esac
}

strip_runner_frameworks() {
  local app_path="$1"
  local frameworks_dir="$app_path/Frameworks"

  if [[ ! -d "$frameworks_dir" ]]; then
    echo "Frameworks directory not found: $frameworks_dir" >&2
    exit 1
  fi

  rm -rf "$frameworks_dir"/XC*.framework
  rm -rf "$frameworks_dir"/XCTest*.framework
  rm -rf "$frameworks_dir"/Testing.framework
  rm -f "$frameworks_dir"/libXCTestSwiftSupport.dylib
}

find_source_app

mkdir -p "$PREBUILT_DIR"
rm -rf "$DEST_WDA_APP"
rsync -a "$SOURCE_WDA_APP/" "$DEST_WDA_APP/"

if should_strip_runner_frameworks; then
  strip_runner_frameworks "$DEST_WDA_APP"
  STRIP_MODE_OUTPUT="enabled"
else
  STRIP_MODE_OUTPUT="disabled"
fi

echo "Prepared prebuilt WDA:"
echo "  Source: $SOURCE_WDA_APP"
echo "  Output: $DEST_WDA_APP"
echo "  Target iOS: ${TARGET_IOS_VERSION:-unknown}"
echo "  Strip XCTest frameworks: $STRIP_MODE_OUTPUT"
echo
echo "Remaining runner frameworks:"
if [[ -d "$DEST_WDA_APP/Frameworks" ]]; then
  find "$DEST_WDA_APP/Frameworks" -maxdepth 1 -mindepth 1 -print | sed 's#^#  - #'
else
  echo "  - none"
fi
