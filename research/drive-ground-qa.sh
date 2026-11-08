#!/bin/bash
# QA driver: ground-contact leg IK + lighting/shadow verification
set -u
cd /home/z/my-project
OUT=research
HARNESS=$(cat research/qa-ground-shadow.js)

agent-browser open http://localhost:3000/ >/dev/null 2>&1
agent-browser set viewport 1600 900 >/dev/null 2>&1
sleep 4

# inject the harness
agent-browser eval "$HARNESS" >/dev/null 2>&1

# shot loop: watch __qaReadyForShot, capture, ack
END=$((SECONDS + 75))
while [ $SECONDS -lt $END ]; do
  DONE=$(agent-browser eval "window.__qaDone === true" 2>/dev/null | tr -d '\n"')
  if [ "$DONE" = "true" ]; then break; fi
  NAME=$(agent-browser eval "window.__qaReadyForShot || ''" 2>/dev/null | tr -d '\n"')
  if [ -n "$NAME" ] && [ "$NAME" != "undefined" ]; then
    TAKEN=$(agent-browser eval "window.__qaShotTaken || ''" 2>/dev/null | tr -d '\n"')
    if [ "$TAKEN" != "$NAME" ]; then
      sleep 0.35
      agent-browser screenshot "$OUT/qs-$NAME.png" >/dev/null 2>&1
      agent-browser eval "window.__qaShotTaken = '$NAME'" >/dev/null 2>&1
    fi
  fi
  sleep 0.25
done

# fetch results
agent-browser eval "JSON.stringify(window.__qaResult || {ok:false, error:'no result'})"
echo ""
agent-browser errors 2>/dev/null | head -20
agent-browser close >/dev/null 2>&1
