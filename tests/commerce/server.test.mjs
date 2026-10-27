import { test } from 'node:test';
import assert from 'node:assert/strict';
let handler, role = 'admin', calls = [], legacyPages = [];
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL:'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key', IMWEB_API_KEY:'synthetic-imweb-key', IMWEB_SECRET_KEY:'synthetic-imweb-secret' })[k] }, serve: fn => { handler = fn; } };
globalThis.EdgeRuntime = { waitUntil() {} };
globalThis.fetch = async (url, options = {}) => {
  const address = new URL(url); calls.push({ path:address.pathname, query:address.search, method:options.method || 'GET', body:options.body });
  const json = value => new Response(JSON.stringify(value), { headers:{'Content-Type':'application/json'} });
  if (address.pathname === '/auth/v1/user') return options.headers.Authorization === 'Bearer synthetic-user-token' ? json({id:'synthetic-user',email_confirmed_at:'2026-01-01',is_anonymous:false}) : new Response('{}',{status:401});
  if (address.pathname === '/rest/v1/commerce_access') return json([{member_id:'synthetic-member',role}]);
  if (address.pathname === '/rest/v1/channel_sales_log') return json(legacyPages.shift() || []);
  if (address.pathname === '/rest/v1/rpc/commerce_claim') return json(null);
  if (address.pathname === '/rest/v1/commerce_channels') return json([{id:'imweb',versions:['v1','v2'],history_start:'2026-10-01',schedule_enabled:false,last_success_at:null}]);
  if (address.pathname === '/rest/v1/commerce_jobs' || address.pathname === '/rest/v1/commerce_checks') return json([]);
  throw new Error('Unexpected test request: ' + address.pathname);
};
await import('../../supabase/functions/commerce-api/index.ts');
const req = (path, method='GET', body, token='synthetic-user-token') => handler(new Request('https://app.example.test/commerce-api/'+path, { method, headers:token ? {Authorization:'Bearer '+token} : {}, ...(body ? {body:JSON.stringify(body)} : {}) }));
test('anonymous and forged tokens cannot read manual comparison',async()=>{
  calls=[];assert.equal((await req('comparison?from=2026-10-01&to=2026-10-02','GET',null,null)).status,401);assert.equal(calls.length,0);
  assert.equal((await req('comparison?from=2026-10-01&to=2026-10-02','GET',null,'forged')).status,401);assert.equal(calls.some(x=>x.path.endsWith('channel_sales_log')),false);
});
test('non-admin cannot read comparison or advance the importer',async()=>{
  role='reader';calls=[];assert.equal((await req('comparison?from=2026-10-01&to=2026-10-02')).status,403);assert.equal((await req('advance','POST',{})).status,403);assert.equal(calls.some(x=>x.path.endsWith('channel_sales_log')||x.path.includes('/rpc/')),false);role='admin';
});
test('comparison paginates all manual rows without writing or combining sources',async()=>{
  calls=[];legacyPages=[Array.from({length:1000},(_,i)=>({id:i,date:'2026-10-01',amount:100})),[{id:1000,date:'2026-10-02',amount:-200}]];
  const response=await req('comparison?from=2026-10-01&to=2026-10-02');assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.amount,99800);assert.equal(result.rows,1001);assert.equal(result.included_in_api_total,false);assert.equal(result.comparison_basis,'unverified');assert(calls.every(x=>x.method==='GET'));
  const reads=calls.filter(x=>x.path.endsWith('channel_sales_log'));assert.equal(reads.length,2);assert(reads[1].query.includes('offset=1000'));assert(decodeURIComponent(reads[0].query).includes('channel=eq.자사몰'));
});
test('missing manual amounts stay unknown rather than becoming zero',async()=>{
  legacyPages=[[{id:1,date:'2026-10-01',amount:null}]];const result=await (await req('comparison?from=2026-10-01&to=2026-10-02')).json();assert.equal(result.amount,null);assert.equal(result.invalid_amount_rows,1);
});
test('manual advance uses the existing queue and never writes legacy tables',async()=>{
  calls=[];const response=await req('advance','POST',{});assert.equal(response.status,200);assert.deepEqual(await response.json(),{state:'idle'});assert(calls.some(x=>x.path==='/rest/v1/rpc/commerce_claim'));assert(calls.filter(x=>x.method!=='GET').every(x=>x.path==='/rest/v1/rpc/commerce_claim'));
});
test('scheduler stays off and cannot be enabled from the verification screen',async()=>{
  calls=[];assert.equal((await req('tick','POST',{},null)).status,409);assert.equal(calls.length,0);
  assert.equal((await req('settings','POST',{history_start:'2026-10-01',versions:['v2'],schedule_enabled:true})).status,409);assert(calls.every(x=>x.method==='GET'));
});
