const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, readdirSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const source = readFileSync(`${__dirname}/public/viewer.js`, 'utf8');
test('onboarding block copies as shell commands rather than terminal output', () => {
  const html = readFileSync(`${__dirname}/public/index.html`, 'utf8');
  const block = html.match(/<pre>([\s\S]*?)<\/pre>/)[1].replace(/<[^>]+>/g, '');
  const {spawnSync} = require('node:child_process');
  assert.equal(spawnSync('/bin/sh', ['-n'], {input:block, encoding:'utf8'}).status, 0);
  const commands = block.split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(commands.length, 4);
  assert.ok(commands.every(line => /^(npm|tardy) /.test(line)));
  assert.ok(!block.includes('✓'));
});
test('all public pages use the Tardy icon outside the hosting favicon route', () => {
  const iconPath = '/brand/tardy-alarm-v1.svg?v=1';
  const icon = readFileSync(`${__dirname}/public${iconPath.split('?')[0]}`, 'utf8');
  assert.match(icon, /<title>Tardy<\/title>/);
  assert.match(icon, /#FFC21A/);
  for (const file of readdirSync(`${__dirname}/public`).filter(file => file.endsWith('.html'))) {
    const html = readFileSync(`${__dirname}/public/${file}`, 'utf8');
    assert.ok(html.includes(`href="${iconPath}"`), `${file}: branded favicon`);
    assert.ok(!html.includes('/favicon.svg'), `${file}: avoid reserved platform favicon`);
    for (const logo of html.matchAll(/<img[^>]*src="([^"]+)"[^>]*alt=""/g)) {
      assert.equal(logo[1], iconPath, `${file}: brand logo matches favicon`);
    }
  }
});
async function run(search, response, navigator = {}) {
  const elements = new Map(); const calls = [];
  const node = () => ({children:[],textContent:'',append(...values){this.children.push(...values);},addEventListener(){}});
  const context = {URL,URLSearchParams,AbortSignal,location:{search,hostname:'tardy.news',origin:'https://tardy.news'},navigator,document:{getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);},createElement:node},fetch:async(url,options)=>{calls.push({url,options});return typeof response === 'function' ? response(url) : response;}};
  runInNewContext(source,context); await new Promise(resolve=>setImmediate(resolve)); return {elements,calls};
}
test('demo is labeled and makes no backend request',async()=>{const {elements,calls}=await run('?demo=1');assert.equal(calls.length,0);assert.match(elements.get('label').textContent,/DEMO/);assert.equal(elements.get('player').children.length,1);});
test('invalid links never call backend',async()=>{const {calls}=await run('?id=nope');assert.equal(calls.length,0);});
test('private or removed posts expose no caption or media',async()=>{const {elements,calls}=await run('?id=11111111-1111-1111-1111-111111111111',{status:404});assert.match(elements.get('title').textContent,/isn’t available/);assert.equal(elements.has('caption'),false);assert.equal(calls[0].options.credentials,'omit');});
test('shares the deployed viewer asset rather than an unsupported nested route',async()=>{
  const id='11111111-1111-1111-1111-111111111111';
  let shared;
  const {elements}=await run(`?id=${id}`,{status:200,ok:true,json:async()=>({caption:'Public work',media:[]})},{share:async value=>{shared=value;}});
  await elements.get('share').onclick();
  assert.equal(shared.url,`https://tardy.news/viewer.html?id=${id}`);
});
test('caption is text and unsafe media schemes are rejected',async()=>{const {elements}=await run('?id=11111111-1111-1111-1111-111111111111',{status:200,ok:true,json:async()=>({caption:'<script>nope</script>',media:[{type:'image',url:'javascript:alert(1)'},{type:'image',url:'https://cdn.test/image.jpg'}],links:[{url:'javascript:alert(1)'}]})});assert.equal(elements.get('caption').textContent,'<script>nope</script>');assert.equal(elements.get('player').children.length,1);assert.equal(elements.has('sources'),false);});
test('browsing uses anonymous public feed and preserves full captions',async()=>{
  const caption = 'A long caption '.repeat(100);
  const {elements,calls}=await run('?id=11111111-1111-1111-1111-111111111111',url=>({status:200,ok:true,json:async()=>url.includes('/feed?') ? {items:[{id:'22222222-2222-2222-2222-222222222222',caption,media:[]}]} : {caption:'Shared post',media:[]}}));
  assert.equal(elements.get('more').children.length,1);
  assert.equal(elements.get('more').children[0].children[1].children[0].textContent,caption);
  assert.equal(calls.find(call=>call.url.includes('/feed?')).options.credentials,'omit');
});
