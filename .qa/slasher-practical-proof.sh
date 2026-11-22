#!/usr/bin/env bash
# A/B full source trees, not the branch base. Keep pacing and instrumented
# draws/stills separate; don't run timing trials in parallel.
set -euo pipefail
control=${1:?control src tree}
candidate=${2:?candidate src tree}
root=${3:-.cache/practical-optics/final}
mode=${4:-all}
[[ "$mode" =~ ^(all|pacing|profiles|shots)$ ]] || { echo 'Expected all, pacing, profiles, or shots' >&2; exit 1; }
export SR_SOFTWARE=${SR_SOFTWARE:-1}
mkdir -p "$root"/{before,after}
run() {
  local rev=$1 name=$2 source=$candidate; shift 2
  if [[ $rev == before ]]; then source=$control; fi
  echo "$rev $name" >&2
  SR_SOURCE="$source" node .qa/slasher-replay.mjs --fixed --empty-teardown "$@" > "$root/$rev/$name.json"
}

desktop=(--width=960 --height=544)
portrait=(--width=390 --height=844)
for fixture in high bridge portrait station; do
  stage=(--wet --route=forward)
  layout=("${desktop[@]}" --tier=ultra --scale=2.25)
  if [[ $fixture == high ]]; then layout=("${desktop[@]}" --tier=high --scale=1.5); fi
  if [[ $fixture == portrait ]]; then stage=(--wet --route=capture); layout=("${portrait[@]}" --tier=ultra --scale=2.25); fi
  if [[ $fixture == station ]]; then stage=(--scene=station --route=capture); fi
  flags=("${stage[@]}" "${layout[@]}" --fixture=crowd --at-x=945 --shadow-props --warmup=36 --frames=90)
  if [[ $mode == all || $mode == pacing ]]; then
    for i in 1 2 3; do
      order=(before after)
      if (( i % 2 == 0 )); then order=(after before); fi
      for rev in "${order[@]}"; do run "$rev" "$fixture-pacing-$i" "${flags[@]}"; done
    done
  fi
  if [[ $mode == all || $mode == profiles ]]; then
    for rev in before after; do run "$rev" "$fixture-profile" "${flags[@]}" --stages --optics-metrics --shadow-metrics; done
  fi
done

if [[ $mode == all || $mode == shots ]]; then
  for rev in before after; do
    run "$rev" lamp "${desktop[@]}" --wet --at-x=705 --route=forward --tier=ultra --scale=2.25 --fixture=idle --warmup=24 --frames=30 --trace-state --pixels="$root/$rev/lamp"
    run "$rev" sign "${desktop[@]}" --wet --at-x=1795 --route=forward --tier=low --scale=1 --fixture=idle --warmup=24 --frames=30 --trace-state --pixels="$root/$rev/sign"
    run "$rev" fight "${desktop[@]}" --wet --at-x=945 --route=forward --tier=ultra --scale=2.25 --fixture=crowd --shadow-props --warmup=30 --frames=60 --trace-state --pixels="$root/$rev/fight"
    run "$rev" portrait "${portrait[@]}" --wet --at-x=945 --route=capture --tier=ultra --scale=2.25 --fixture=crowd --shadow-props --warmup=30 --frames=60 --trace-state --pixels="$root/$rev/portrait"
    run "$rev" station "${desktop[@]}" --scene=station --at-x=705 --route=capture --tier=ultra --scale=2.25 --fixture=idle --warmup=24 --frames=30 --trace-state --pixels="$root/$rev/station"
  done
fi
