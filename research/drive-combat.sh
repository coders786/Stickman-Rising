#!/bin/bash
set -u
cd /home/z/my-project
agent-browser open http://localhost:3000/ >/dev/null 2>&1
agent-browser set viewport 1600 900 >/dev/null 2>&1
sleep 4
agent-browser eval "window.__sr.startRun('katana')" >/dev/null 2>&1; sleep 1; agent-browser eval "$(cat research/qa-harness.js)" >/dev/null 2>&1
END=$((SECONDS + 60))
while [ $SECONDS -lt $END ]; do
  DONE=$(agent-browser eval "window.__qaDone === true" 2>/dev/null | tr -d '\n"')
  if [ "$DONE" = "true" ]; then break; fi
  sleep 0.4
done
agent-browser eval "JSON.stringify(window.__qaResult || {ok:false})" > research/combat-regression.json
cat research/combat-regression.json
echo ""
agent-browser close >/dev/null 2>&1
