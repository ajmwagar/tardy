const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const source = readFileSync(`${__dirname}/public/viewer.js`, 'utf8');
async function run(search, response) {
  const elements = new Map(); const calls = [];
  const node = () => ({children:[],textContent:'',append(value){this.children.push(value);},addEventListener(){}});
  const context = {URL,URLSearchParams,AbortSignal,location:{search,hostname:'tardy.news',origin:'https://tardy.news'},navigator:{},document:{getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);},createElement:node},fetch:async(url,options)=>{calls.push({url,options});return response;}};
  runInNewContext(source,context); await new Promise(resolve=>setImmediate(resolve)); return {elements,calls};
}
test('demo is labeled and makes no backend request',async()=>{const {elements,calls}=await run('?demo=1');assert.equal(calls.length,0);assert.match(elements.get('label').textContent,/DEMO/);assert.equal(elements.get('player').children.length,1);});
test('invalid links never call backend',async()=>{const {calls}=await run('?id=nope');assert.equal(calls.length,0);});
test('private or removed posts expose no caption or media',async()=>{const {elements,calls}=await run('?id=11111111-1111-1111-1111-111111111111',{status:404});assert.match(elements.get('title').textContent,/isn’t available/);assert.equal(elements.has('caption'),false);assert.equal(calls[0].options.credentials,'omit');});
test('caption is text and unsafe media schemes are rejected',async()=>{const {elements}=await run('?id=11111111-1111-1111-1111-111111111111',{status:200,ok:true,json:async()=>({caption:'<script>nope</script>',media:[{type:'image',url:'javascript:alert(1)'},{type:'image',url:'https://cdn.test/image.jpg'}],links:[{url:'javascript:alert(1)'}]})});assert.equal(elements.get('caption').textContent,'<script>nope</script>');assert.equal(elements.get('player').children.length,1);assert.equal(elements.has('sources'),false);});
