#!/usr/bin/env bash
# Compare two full source trees, including working/untracked art. Set the
# browser tools as for slasher-replay. Never run the timing trials in parallel.
set -euo pipefail
control=${1:?control src tree}
candidate=${2:?candidate src tree}
root=${3:-.cache/water-relay}
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

for kind in desktop-forward desktop-capture portrait-capture; do
  route=${kind#*-}
  viewport=(--width=1000 --height=560)
  if [[ $kind == portrait-capture ]]; then viewport=(--width=390 --height=844); fi
  flags=(--wet --fixture=crowd --tier=ultra --scale=2.25 --route="$route" --warmup=36 --frames=90 "${viewport[@]}")
  if [[ $mode == all || $mode == pacing ]]; then
    for trial in 1 2 3; do
      revisions=(before after)
      if (( trial % 2 == 0 )); then revisions=(after before); fi
      for rev in "${revisions[@]}"; do run "$rev" "$kind-pacing-$trial" "${flags[@]}"; done
    done
  fi
  if [[ $mode == all || $mode == profiles ]]; then
    for rev in before after; do run "$rev" "$kind-profile" "${flags[@]}" --stages; done
  fi
done

if [[ $mode == all || $mode == shots ]]; then
  for rev in before after; do
    run "$rev" lamp --wet --fixture=idle --tier=low --route=forward --scale=1 --at-x=880 --warmup=30 --frames=72 --trace-state --pixels="$root/$rev/lamp"
    run "$rev" sign --wet --fixture=idle --tier=low --route=forward --scale=1 --at-x=1650 --warmup=30 --frames=72 --trace-state --pixels="$root/$rev/sign"
    run "$rev" fight --wet --fixture=crowd --tier=ultra --route=capture --scale=2.25 --width=390 --height=844 --warmup=30 --frames=72 --trace-state --pixels="$root/$rev/fight"
    run "$rev" station --scene=station --fixture=crowd --tier=ultra --route=capture --scale=2.25 --width=390 --height=844 --warmup=30 --frames=72 --trace-state --pixels="$root/$rev/station"
  done
fi
