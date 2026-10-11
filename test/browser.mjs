import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const port = 5175, origin = `http://127.0.0.1:${port}`, session = `grotto-check-${process.pid}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'inherit' });
function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], { input, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Browser command failed');
  return result.stdout;
}
function evaluate(code) {
  const response = JSON.parse(browser(['eval', '--stdin', '--json'], code));
  if (!response.success) throw new Error(JSON.stringify(response.error));
  return response.data.result;
}
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (server.exitCode !== null) throw new Error('Vite exited before startup');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Vite startup timed out');
  for (const mode of ['webgl', 'auto']) {
    for (const file of ['sweep.js', 'features.js', 'landmarks.js', 'regressions.js', 'coves.js', 'trees.js']) {
      browser(['open', `${origin}/?test&fresh${mode === 'webgl' ? '&webgl' : ''}`]);
      browser(['wait', '--fn', '!!window.__grotto']);
      const backend = evaluate('window.__grotto.renderer.backend.constructor.name');
      const result = evaluate(readFileSync(new URL(file, import.meta.url), 'utf8'));
      console.log(`${mode} (${backend}) ${file}\n${result}`);
      if (typeof result !== 'string' || /(^|\n)FAIL\b/.test(result) || !result.includes('PASS ')) throw new Error(`${file} failed`);
      const rendered = evaluate('(async () => { const image = await window.__grotto.snap(); return image.startsWith("data:image/png") && image.length > 1000; })()');
      if (!rendered) throw new Error('Render smoke check failed');
      if (file === 'regressions.js') {
        const saved = evaluate('(() => { if (!window.__grotto.app.save()) throw new Error("Save failed"); return JSON.stringify({ world: window.__grotto.world.save(), hour: window.__grotto.app.hour }); })()');
        browser(['open', `${origin}/?test${mode === 'webgl' ? '&webgl' : ''}`]);
        browser(['wait', '--fn', '!!window.__grotto']);
        const restored = evaluate('JSON.stringify({ world: window.__grotto.world.save(), hour: window.__grotto.app.hour })');
        if (restored !== saved) throw new Error('Save did not survive page reload');
        console.log('PASS saved world and time survive page reload');
      }
    }
  }
} finally {
  server.kill();
  spawnSync('agent-browser', ['--session', session, 'close'], { encoding: 'utf8', timeout: 10000 });
}
