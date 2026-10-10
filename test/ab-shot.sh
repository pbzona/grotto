#!/usr/bin/env bash
# agent-browser render check: test/ab-shot.sh out.png "js setup" [hour]
# Assumes `npx vite --port 5173` is running and the page is open in the agent-browser session.
OUT=${1:-test/out/ab.png}; PRE=${2:-""}; HOUR=${3:-undefined}
agent-browser eval "(async () => { ${PRE}; await window.__grotto.snap(${HOUR}); return 'ok'; })()" >/dev/null
agent-browser screenshot "$OUT" | tail -1
