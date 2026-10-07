import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/tardy-news.mjs', import.meta.url));
const skill = fileURLToPath(new URL('../../../skills/tardy/SKILL.md', import.meta.url));
function run(args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('global install links one canonical copy, repeats safely, and protects edits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tardy-global-'));
  const canonical = path.join(dir, 'canonical');
  const codex = path.join(dir, 'codex');
  const claude = path.join(dir, 'claude');
  const args = ['install', '--global', '--source', skill, '--dir', canonical, '--codex-dir', codex, '--claude-dir', claude];
  for (let i = 0; i < 2; i++) {
    const result = await run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readlink(codex), canonical);
    assert.equal(await readlink(claude), canonical);
    assert.equal(await readFile(path.join(codex, 'SKILL.md'), 'utf8'), await readFile(skill, 'utf8'));
  }
  await writeFile(path.join(canonical, 'SKILL.md'), 'my edited skill');
  assert.equal((await run(args)).status, 1);
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'my edited skill');
});

test('uploads portrait media once, resumes an ambiguous post with the same ID, verifies and publishes explicitly', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tardy-upload-'));
  const state = path.join(dir, 'state.json');
  const video = path.join(dir, 'brag.mp4');
  const poster = path.join(dir, 'brag.jpg');
  const caption = path.join(dir, 'caption.txt');
  const helper = path.join(dir, 'helper.mjs');
  const calls = path.join(dir, 'uploads.log');
  await writeFile(video, 'video'); await writeFile(poster, 'poster');
  await writeFile(caption, 'A rich caption\n\nSource, verified result, and limitation.\n');
  await writeFile(helper, `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);const video=args[1].endsWith('.mp4');
if(args[0]==='--inspect') console.log(JSON.stringify({sha256_base64:video?'video-hash':'poster-hash',bytes:5,...(video?{width:1080,height:1920,duration_ms:22004}:{})}));
else {appendFileSync(${JSON.stringify(calls)},'upload\\n');console.log(JSON.stringify({asset_id:video?'video-id':'poster-id',sha256_base64:video?'video-hash':'poster-hash',verified:true}));}
`, { mode: 0o755 });
  let first = true, saved = null, publicPost = false, approval = false, mismatch = false;
  const requestIds = [];
  const server = createServer((req, res) => {
    let data = ''; req.on('data', (d) => data += d); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/profiles/')) return res.end(JSON.stringify({ id: 'agent' }));
      if (req.method === 'POST') {
        const body = JSON.parse(data); requestIds.push(body.client_request_id);
        if (approval) { res.statusCode = 202; return res.end(JSON.stringify({ suggestion_id:'approval-id' })); }
        saved = { ...body, id: 'post-id', author_profile_id: 'agent' };
        assert.equal(body.visibility, 'private'); assert.equal(body.media[0].duration_ms, 22004);
        if (first) { first = false; res.statusCode = 503; return res.end('{}'); }
        return res.end(JSON.stringify(saved));
      }
      if (req.method === 'PUT') { publicPost = true; assert.equal(JSON.parse(data).visibility, 'public'); return res.end(JSON.stringify(saved)); }
      if (req.url.startsWith('/v1/public/') && !publicPost) { res.statusCode=404; return res.end('{}'); }
      res.end(JSON.stringify(mismatch ? {...saved,caption:'mismatched'} : saved));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  await writeFile(state, JSON.stringify({ api: `http://127.0.0.1:${server.address().port}`, api_token:'never-print-this', profile_id:'agent' }), { mode:0o600 });
  const env = {...process.env, TARDY_MEDIA_UPLOAD_BIN: helper};
  const args = ['reel','--file',video,'--poster',poster,'--caption-file',caption,'--state',state];
  assert.equal((await run(args, env)).status, 1);
  const result = await run(args, env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verified, true);
  assert.equal(requestIds[0], requestIds[1]);
  assert.equal((await readFile(calls,'utf8')).split('\n').filter(Boolean).length, 2);
  assert.equal((await run(args,env)).status,0);
  assert.equal(requestIds.length,2);
  mismatch = true;
  assert.equal((await run(args,env)).status,1, 'read-back mismatch must fail');
  mismatch = false;
  const job = await readFile(video+'.tardy.json','utf8');
  assert.doesNotMatch(job+result.stdout,/never-print-this/);
  assert.equal((await run([...args,'--visibility','public'],env)).status,1);
  const published=await run(['public','--post-id','post-id','--state',state],env);
  assert.equal(published.status,0,published.stderr);
  assert.equal(JSON.parse(published.stdout).url,null, 'local API must not invent a production share URL');
  assert.equal(JSON.parse(published.stdout).verified,true);
  await writeFile(caption,'Changed caption');
  assert.equal((await run(args,env)).status,1);
  approval = true;
  const queuedArgs = [...args,'--job',path.join(dir,'approval.json')];
  const queued = await run(queuedArgs,env);
  assert.equal(queued.status,0,queued.stderr);
  assert.equal(JSON.parse(queued.stdout).status,'awaiting_approval');
  const writes = requestIds.length;
  const again = await run(queuedArgs,env);
  assert.equal(JSON.parse(again.stdout).status,'awaiting_approval');
  assert.equal(requestIds.length,writes,'queued approval must not repost');
});
