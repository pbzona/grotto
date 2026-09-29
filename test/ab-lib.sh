# helpers for agent-browser interaction tests (source me)
export AGENT_BROWSER_EXECUTABLE_PATH=${AGENT_BROWSER_EXECUTABLE_PATH:-$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome}
ev() { agent-browser eval "$1" 2>&1 | tail -1; }
# screen coords of a world point: scr x y z  -> "sx sy"
scr() { ev "(() => { const g=window.__grotto; g.camera.updateMatrixWorld(); const v=new (g.camera.position.constructor)($1,$2,$3).project(g.camera); const r=g.renderer.domElement.getBoundingClientRect(); return Math.round(r.left+(v.x+1)/2*r.width)+' '+Math.round(r.top+(1-v.y)/2*r.height); })()" | tr -d '"'; }
click_at() { agent-browser mouse move $1 $2 >/dev/null; agent-browser mouse down left >/dev/null; agent-browser mouse up left >/dev/null; }
drag() { agent-browser mouse move $1 $2 >/dev/null; agent-browser mouse down left >/dev/null; agent-browser mouse move $3 $4 --steps 6 >/dev/null; agent-browser mouse up left >/dev/null; }
