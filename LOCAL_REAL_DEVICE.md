# WebDriverAgent Local Real Device Setup

This workspace is prepared for running WebDriverAgent on a physical iPhone or iPad.

## What is already confirmed

- Xcode is installed: `Xcode 26.2`
- iOS SDK is installed: `iphoneos26.2`
- Apple Development certificates exist in Keychain
- The Appium WebDriverAgent source is checked out in this repository

## Current blockers found on this Mac

1. No connected iOS device is currently available to Xcode.
   - `xcrun xcdevice list` reports the attached devices as unavailable.
   - Xcode suggests: unlock the device, attach it with a cable, trust this Mac, and enable Developer Mode.
2. The first signing probe failed because Xcode has no usable account session for Team `63BGMPKFC9`.
   - Error: `No Account for Team "63BGMPKFC9"`
   - There are also no local provisioning profiles in `~/Library/MobileDevice/Provisioning Profiles`

## Fix the environment first

1. Connect the device with a cable.
2. Unlock the device and tap `Trust`.
3. On the device, enable `Developer Mode`, then reboot if iOS asks for it.
4. Open Xcode and sign in with the Apple ID that owns the development team you want to use.
5. Wait until Xcode finishes preparing the device.
6. Confirm the device becomes available:

```bash
xcrun xcdevice list
```

Look for your device with `"available" : true`.

## Start WebDriverAgent on the real device

Pick:

- `TEAM_ID`: your Apple developer team ID
- `BUNDLE_ID`: a unique bundle id you own, for example `com.yourname.WebDriverAgentRunner`
- `DEVICE_UDID`: the device UDID from `xcrun xcdevice list`

Then run:

```bash
TEAM_ID=YOUR_TEAM_ID \
BUNDLE_ID=com.yourname.WebDriverAgentRunner \
DEVICE_UDID=YOUR_DEVICE_UDID \
./Scripts/run-real-device.sh
```

This runs the `WebDriverAgentRunner` test target directly on the device.

## Access port 8100 from the Mac

If `iproxy` is installed:

```bash
./Scripts/forward-wda-port.sh YOUR_DEVICE_UDID
```

Then verify:

```bash
curl http://127.0.0.1:8100/status
```

## Useful discovery commands

List all devices:

```bash
xcrun xcdevice list
```

List only CoreDevice entries:

```bash
xcrun devicectl list devices
```

List signing identities:

```bash
security find-identity -v -p codesigning
```
