#!/bin/bash
set -u
cd /home/z/my-project
OUT=research
agent-browser open http://localhost:3000/ >/dev/null 2>&1
agent-browser set viewport 1600 900 >/dev/null 2>&1
sleep 5
agent-browser eval "$(cat research/qa-real.js)" >/dev/null 2>&1
END=$((SECONDS + 120))
while [ $SECONDS -lt $END ]; do
  DONE=$(agent-browser eval "window.__qaReal && window.__qaReal.done === true" 2>/dev/null | tr -d '\n"')
  NAME=$(agent-browser eval "window.__qaReadyForShot || ''" 2>/dev/null | tr -d '\n"')
  if [ -n "$NAME" ] && [ "$NAME" != "undefined" ]; then
    TAKEN=$(agent-browser eval "window.__qaShotTaken || ''" 2>/dev/null | tr -d '\n"')
    if [ "$TAKEN" != "$NAME" ]; then
      sleep 0.4
      agent-browser screenshot "$OUT/$NAME.png" >/dev/null 2>&1
      agent-browser eval "window.__qaShotTaken = '$NAME'" >/dev/null 2>&1
    fi
  fi
  if [ "$DONE" = "true" ]; then break; fi
  sleep 0.2
done
echo "--- done ---"
agent-browser errors 2>/dev/null | head -6
agent-browser close >/dev/null 2>&1
