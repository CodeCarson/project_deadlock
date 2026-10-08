#!/usr/bin/env bash
# Headless Electron validation using the cloud image's existing Xorg + dummy driver.
set -euo pipefail
cd "$(dirname "$0")/.."
companion_display="${COMPANION_TEST_DISPLAY:-:98}"
companion_tmp="$(mktemp -d /tmp/companion-display.XXXXXX)"
companion_x_pid=""
companion_wm_pid=""
cleanup() {
  if [[ -n "$companion_wm_pid" ]]; then kill "$companion_wm_pid" 2>/dev/null || true; fi
  if [[ -n "$companion_x_pid" ]]; then kill "$companion_x_pid" 2>/dev/null || true; fi
  rm -rf "$companion_tmp"
}
trap cleanup EXIT
if DISPLAY="$companion_display" xdpyinfo >/dev/null 2>&1; then
  printf 'Display %s is already in use. Choose another COMPANION_TEST_DISPLAY.\n' "$companion_display" >&2
  exit 1
fi
cat > "$companion_tmp/xorg.conf" <<'XORG'
Section "ServerFlags"
  Option "AutoAddDevices" "false"
  Option "AutoEnableDevices" "false"
EndSection
Section "Device"
  Identifier "DummyDevice"
  Driver "dummy"
  VideoRam 256000
EndSection
Section "Monitor"
  Identifier "DummyMonitor"
  HorizSync 30-100
  VertRefresh 50-75
  Modeline "1440x1000" 120.00 1440 1528 1672 1904 1000 1003 1013 1040
EndSection
Section "Screen"
  Identifier "DummyScreen"
  Device "DummyDevice"
  Monitor "DummyMonitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "1440x1000"
  EndSubSection
EndSection
XORG
/usr/lib/xorg/Xorg "$companion_display" -config "$companion_tmp/xorg.conf" -logfile "$companion_tmp/xorg.log" -nolisten tcp -noreset -novtswitch >"$companion_tmp/xorg.out" 2>&1 &
companion_x_pid=$!
for companion_attempt in {1..100}; do
  if DISPLAY="$companion_display" xdpyinfo >/dev/null 2>&1; then break; fi
  if ! kill -0 "$companion_x_pid" 2>/dev/null; then cat "$companion_tmp/xorg.out"; exit 1; fi
  sleep 0.1
done
DISPLAY="$companion_display" xdpyinfo >/dev/null
DISPLAY="$companion_display" XDG_CONFIG_HOME="$companion_tmp/config" XDG_CACHE_HOME="$companion_tmp/cache" dbus-run-session -- xfwm4 --compositor=off --sm-client-disable >"$companion_tmp/wm.out" 2>&1 &
companion_wm_pid=$!
for companion_attempt in {1..100}; do
  if DISPLAY="$companion_display" xprop -root _NET_SUPPORTING_WM_CHECK | rg -q 'window id'; then break; fi
  if ! kill -0 "$companion_wm_pid" 2>/dev/null; then cat "$companion_tmp/wm.out"; exit 1; fi
  sleep 0.1
done
DISPLAY="$companion_display" xprop -root _NET_SUPPORTING_WM_CHECK | rg -q 'window id'
# Only the test process disables Chromium's OS sandbox in this restricted Linux container.
# The production app keeps context isolation, renderer sandboxing, and no Node integration.
DISPLAY="$companion_display" COMPANION_TEST_NO_SANDBOX=1 npm run test:desktop
