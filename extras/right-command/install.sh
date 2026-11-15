#!/bin/bash
# Installs One Infinite Loop Key: a tap on the right Command key types ⌘.
#
#   bash install.sh             install, or update, and start it
#   bash install.sh --uninstall stop it and remove everything this put in place
#
# It puts one app in ~/Library/Application Support/One Infinite Loop/ and one
# login item in ~/Library/LaunchAgents/. It needs no administrator password,
# installs nothing else, and changes no other setting. macOS then asks for
# two permissions in System Settings > Privacy & Security, which only you can
# give: Input Monitoring (to notice the tap) and Accessibility (to type ⌘).
set -euo pipefail

LABEL="science.tharp.one-infinite-loop.key"
NAME="One Infinite Loop Key"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="$HOME/Library/Application Support/One Infinite Loop"
APP="$HOME_DIR/$NAME.app"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

[ "$(uname -s)" = "Darwin" ] || { echo "This is for macOS only."; exit 1; }

stop() { launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; }

if [ "${1:-}" = "--uninstall" ]; then
  stop
  rm -f "$AGENT"
  rm -rf "$APP"
  rmdir "$HOME_DIR" 2>/dev/null || true
  echo "Removed $NAME. Its entries in System Settings > Privacy & Security can be removed there with the minus button."
  exit 0
fi

# The binary: built here from the source beside this script where a Swift
# compiler is already installed, else the prebuilt one, checked against its
# recorded checksum. Nothing is downloaded either way.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
build() {
  xcode-select -p >/dev/null 2>&1 && xcrun --find swiftc >/dev/null 2>&1 || return 1
  xcrun swiftc -O -target arm64-apple-macos12 "$HERE/RightCommandKey.swift" -o "$WORK/arm64" 2>/dev/null &&
    xcrun swiftc -O -target x86_64-apple-macos12 "$HERE/RightCommandKey.swift" -o "$WORK/x86_64" 2>/dev/null &&
    lipo -create "$WORK/arm64" "$WORK/x86_64" -output "$WORK/OneInfiniteLoopKey"
}
if build; then
  BUILT="built from RightCommandKey.swift"
else
  expected="$(cut -d' ' -f1 "$HERE/prebuilt/OneInfiniteLoopKey.sha256")"
  actual="$(shasum -a 256 "$HERE/prebuilt/OneInfiniteLoopKey" | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || { echo "The prebuilt binary does not match its checksum. Not installing."; exit 1; }
  cp "$HERE/prebuilt/OneInfiniteLoopKey" "$WORK/OneInfiniteLoopKey"
  BUILT="the prebuilt binary (no working Swift compiler here; checksum matched)"
fi
chmod +x "$WORK/OneInfiniteLoopKey"
"$WORK/OneInfiniteLoopKey" --self-test >/dev/null || { echo "The tap rule failed its self-test. Not installing."; exit 1; }

stop
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$WORK/OneInfiniteLoopKey" "$APP/Contents/MacOS/OneInfiniteLoopKey"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>OneInfiniteLoopKey</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1

mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/OneInfiniteLoopKey</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
PLIST
launchctl bootstrap "$DOMAIN" "$AGENT"

echo "Installed $NAME, $BUILT."
if grep -qs "rightCommandEventTap" "$HOME/.hammerspoon/init.lua"; then
  echo "Note: your Hammerspoon setup already types ⌘ on right Command; with both running you get two. Keep one: bash install.sh --uninstall, or remove that part of ~/.hammerspoon/init.lua."
fi
echo "Next: macOS asks for Input Monitoring and Accessibility for \"$NAME\" (System Settings > Privacy & Security). Turn both on. Then tap right Command on its own: it types ⌘."
