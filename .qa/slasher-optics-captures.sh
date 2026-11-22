#!/usr/bin/env bash
# Usage: bash .qa/slasher-optics-captures.sh /absolute/path/to/src output-dir [shot ...]
# Set SR_BROWSER_TOOLS and any platform Chromium library paths first.
set -eu
export SR_SOFTWARE=1
export SR_SOURCE="$1"
d="$2"
shift 2
requested="$*"
mkdir -p "$d"
capture() {
  local name="$1"; shift
  [[ -z "$requested" || " $requested " == *" $name "* ]] || return 0
  echo "$name ($d)"
  node .qa/slasher-replay.mjs --fixed --scale=1 --warmup=30 --frames=72 --trace-state --stages --empty-teardown \
    --pixels="$d/$name" "$@" > "$d/$name.json"
}
capture bridge-lamp --route=forward --tier=low --wet --fixture=idle --at-x=880
capture bridge-sign --route=capture --tier=low --wet --fixture=idle --at-x=1755
capture station-sign --route=forward --tier=low --scene=station --fixture=idle --at-x=1755
capture bridge-fight --route=capture --tier=low --wet --fixture=crowd --width=390 --height=844
capture station-fight --route=capture --tier=low --scene=station --fixture=crowd --width=390 --height=844
capture bridge-ultra --route=capture --tier=ultra --wet --fixture=crowd
capture station-ultra --route=capture --tier=ultra --scene=station --fixture=crowd
capture bridge-forward --route=forward --tier=ultra --wet --fixture=crowd
capture station-forward --route=forward --tier=ultra --scene=station --fixture=crowd
