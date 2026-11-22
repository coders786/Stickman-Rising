#!/usr/bin/env bash
# Replay a frozen post-water control and a candidate, at the same tier and DPR.
# Set SR_BROWSER_TOOLS (or use the default in slasher-replay); this runs serially.
set -euo pipefail
control=$(realpath "${1:?pass the control src directory}")
candidate=$(realpath "${2:?pass the candidate src directory}")
root=${3:-.cache/shadow-footprint}
mode=${4:-all}
case "$mode" in all|pacing|profiles|shots|raster) ;; *) echo 'mode: all, pacing, profiles, shots or raster' >&2; exit 2;; esac
mkdir -p "$root/before" "$root/after"
export SR_SOFTWARE=${SR_SOFTWARE:-1}

run() {
  local side=$1 name=$2 source=$control
  shift 2
  if [[ "$side" == 'after' ]]; then source=$candidate; fi
  echo "$side · $name"
  SR_SOURCE="$source" node .qa/slasher-replay.mjs --fixed --empty-teardown "$@" > "$root/$side/$name.tmp"
  mv "$root/$side/$name.tmp" "$root/$side/$name.json"
}

fixture() {
  local name=$1 tier=$1 scale=1 warmup=${2:-36}
  local width=960 height=544 stage=(--wet --route=forward)
  case "$name" in
    low) ;;
    medium) scale=1.25 ;;
    high) scale=1.5 ;;
    ultra) scale=2 ;;
    absolute) tier=ultra; scale=2.25 ;;
    portrait) tier=ultra; scale=2.25; width=390; height=844; stage=(--wet --route=capture) ;;
    station) tier=ultra; scale=2.25; stage=(--scene=station --route=capture) ;;
  esac
  common=("--tier=$tier" "--scale=$scale" "--width=$width" "--height=$height" "${stage[@]}" --at-x=945 --shadow-props "--warmup=$warmup")
}

fixtures=(low medium high ultra absolute portrait station)
if [[ "$mode" == all || "$mode" == shots ]]; then
  for name in "${fixtures[@]}"; do
    fixture "$name"
    for side in before after; do
      run "$side" "$name-lamp" "${common[@]}" --fixture=idle --frames=42 --trace-state --pixels="$root/$side/$name-lamp"
    done
  done
  fixture absolute
  for side in before after; do
    run "$side" absolute-fight "${common[@]}" --fixture=crowd --frames=90 --trace-state --pixels="$root/$side/absolute-fight"
    run "$side" absolute-jump "${common[@]}" --fixture=jump --frames=14 --trace-state --pixels="$root/$side/absolute-jump"
  done
fi
if [[ "$mode" == all || "$mode" == profiles ]]; then
  for name in "${fixtures[@]}"; do
    fixture "$name"
    for side in before after; do
      run "$side" "$name-profile" "${common[@]}" --fixture=crowd --frames=90 --stages --shadow-metrics --trace-state
    done
  done
fi
if [[ "$mode" == all || "$mode" == pacing ]]; then
  # Paired runs, reverse order on the middle pair. No hooks, trace or reads.
  for repeat in 1 2 3; do
    sides=(before after)
    if [[ "$repeat" == 2 ]]; then sides=(after before); fi
    for name in "${fixtures[@]}"; do
      fixture "$name"
      for side in "${sides[@]}"; do
        run "$side" "$name-pacing-$repeat" "${common[@]}" --fixture=crowd --frames=90
      done
    done
  done
fi
if [[ "$mode" == all || "$mode" == raster ]]; then
  fixture station 30
  for repeat in 1 2 3; do
    sides=(before after)
    if [[ "$repeat" == 2 ]]; then sides=(after before); fi
    for side in "${sides[@]}"; do
      run "$side" "station-raster-$repeat" "${common[@]}" --fixture=crowd --frames=54 --shadow-raster
    done
  done
fi
