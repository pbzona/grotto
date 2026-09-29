#!/usr/bin/env bash
# agent-browser render check: test/ab-shot.sh out.png "js setup" [hour]
# Assumes `npx vite --port 5173` is running and the page is open in the agent-browser session.
OUT=${1:-test/out/ab.png}; PRE=${2:-""}; HOUR=${3:-undefined}
export AGENT_BROWSER_EXECUTABLE_PATH=${AGENT_BROWSER_EXECUTABLE_PATH:-$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome}
agent-browser eval "(async () => { ${PRE}; await window.__grotto.snap(${HOUR}); return 'ok'; })()" >/dev/null
agent-browser screenshot "$OUT" | tail -1
