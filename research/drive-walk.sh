#!/bin/bash
set -u
cd /home/z/my-project
agent-browser open http://localhost:3000/ >/dev/null 2>&1
agent-browser set viewport 1600 900 >/dev/null 2>&1
sleep 4
agent-browser eval "$(cat research/qa-walkonly.js)" >/dev/null 2>&1
END=$((SECONDS + 40))
while [ $SECONDS -lt $END ]; do
  DONE=$(agent-browser eval "window.__qaWalkDone === true" 2>/dev/null | tr -d '\n"')
  NAME=$(agent-browser eval "window.__qaReadyForShot || ''" 2>/dev/null | tr -d '\n"')
  if [ -n "$NAME" ] && [ "$NAME" != "undefined" ]; then
    TAKEN=$(agent-browser eval "window.__qaShotTaken || ''" 2>/dev/null | tr -d '\n"')
    if [ "$TAKEN" != "$NAME" ]; then
      sleep 0.25
      agent-browser screenshot "research/wk-$NAME.png" >/dev/null 2>&1
      agent-browser eval "window.__qaShotTaken = '$NAME'" >/dev/null 2>&1
    fi
  fi
  if [ "$DONE" = "true" ]; then break; fi
  sleep 0.15
done
agent-browser eval "JSON.stringify(window.__qaLimbShots || {})" > research/walk-results.json
agent-browser close >/dev/null 2>&1
