import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/workspace-auth/handler.mjs';
import { workspaceProfile } from '../../supabase/functions/_shared/workspace-identity.mjs';

const password = 'Synthetic-only-password-29';
function setup({ seed = password, account, throttle = false, collision = false } = {}) {
  const calls = []; let stored = account;
  const env = key => ({ SUPABASE_URL: 'https://auth.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key', WORKSPACE_PASSWORD_CEO: seed })[key];
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const request = async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body });
    if (path.endsWith('/token')) {
      if (throttle) return json({ error_code: 'over_request_rate_limit' }, 429);
      if (stored && body.password === stored.password) return json({ user: stored.user, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
      return json({ error_code: 'invalid_credentials' }, 400);
    }
    if (path.endsWith('/admin/users')) {
      if (stored || collision) return json({ error_code: 'email_exists' }, 422);
      stored = { password: body.password, user: { id: 'synthetic-user', email_confirmed_at: '2026-10-29', app_metadata: body.app_metadata } };
      return json(stored.user);
    }
    if (path.endsWith('/user')) return options.headers.Authorization === 'Bearer synthetic-access' && stored ? json(stored.user) : json({}, 401);
    throw Error('Unexpected endpoint');
  };
  const handler = createHandler({ env, request });
  const login = (body = { member_id: 'ceo', password }, headers = {}) => handler(new Request('https://auth.example.test/workspace-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  const session = token => handler(new Request('https://auth.example.test/workspace-auth/session', { headers: token ? { Authorization: 'Bearer ' + token } : {} }));
  return { login, session, calls };
}
test('first login binds the existing member only after the private initial password matches', async () => {
  const { login, calls, session } = setup();
  const response = await login(), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.profile.id, 'ceo'); assert.equal(data.profile.admin, true);
  assert.deepEqual(Object.keys(data.session).sort(), ['access_token','refresh_token']);
  assert.equal(calls.filter(x => x.path.endsWith('/admin/users')).length, 1);
  assert.equal((await session('synthetic-access')).status, 200);
  await login(); assert.equal(calls.filter(x => x.path.endsWith('/admin/users')).length, 1);
  assert(calls.every(x => !x.path.includes('/rest/')));
});
test('wrong password, missing setup, old short PIN, unknown member and caller role cannot provision', async () => {
  for (const [config, body] of [[{}, {member_id:'ceo',password:'wrong'}], [{seed:''}, {member_id:'ceo',password}], [{seed:'123456'}, {member_id:'ceo',password:'123456'}], [{}, {member_id:'attacker',password}], [{}, {member_id:'hyunjin',password,admin:true}]]) {
    const s = setup(config); const r = await s.login(body);
    assert.equal(r.status, 401); assert.equal(s.calls.some(x => x.path.endsWith('/admin/users')), false);
    assert(!(await r.text()).includes(password));
  }
});
test('Auth rate limiting is honored before any attempt to bootstrap', async () => {
  const s = setup({ throttle:true }); assert.equal((await s.login()).status, 429); assert.equal(s.calls.length,1);
});
test('existing password never gets reset by an old setup secret', async () => {
  const s = setup({ account: { password: 'Newer-private-password', user: { id:'u', email_confirmed_at:'2026', app_metadata:{workspace_member_id:'ceo',workspace_enabled:true} } } });
  assert.equal((await s.login()).status,401);
  assert(s.calls.every(x => x.method !== 'PUT' && x.method !== 'PATCH' && x.method !== 'DELETE'));
});
test('email collisions cannot acquire trusted metadata', async () => {
  const s = setup({ collision:true }); assert.equal((await s.login()).status,401);
  assert(s.calls.every(x => x.method === 'POST'));
});
test('self-registered and disabled identities cannot sign in to the workspace', async () => {
  for (const metadata of [{user_metadata:{workspace_member_id:'ceo',workspace_enabled:true,admin:true}}, {app_metadata:{workspace_member_id:'ceo',workspace_enabled:false}}, {app_metadata:{workspace_member_id:'unknown',workspace_enabled:true}}]) {
    const s = setup({account:{password,user:{id:'u',email_confirmed_at:'2026',...metadata}}});
    assert.equal((await s.login()).status,403);
    assert.equal(s.calls.length,1);
  }
});
test('session rejects missing and forged tokens without minting any account', async () => {
  const s=setup(); assert.equal((await s.session()).status,401); assert.equal(s.calls.length,0);
  assert.equal((await s.session('forged')).status,401); assert(s.calls.every(x=>x.method==='GET'));
});
test('roles come from fixed existing member IDs, never editable or supplied admin flags', () => {
  const base={id:'u',email_confirmed_at:'2026',user_metadata:{admin:true,workspace_member_id:'ceo'}};
  assert.equal(workspaceProfile(base),null);
  assert.equal(workspaceProfile({...base,app_metadata:{workspace_member_id:'hyunjin',workspace_enabled:true,admin:true}}).admin,false);
  assert.equal(workspaceProfile({...base,app_metadata:{workspace_member_id:'hyomin',workspace_enabled:true}}).admin,true);
  assert.equal(workspaceProfile({...base,is_anonymous:true,app_metadata:{workspace_member_id:'ceo',workspace_enabled:true}}),null);
});
test('cross-site login and oversized input are rejected before authentication', async () => {
  const s=setup(); assert.equal((await s.login(undefined,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await s.login({member_id:'ceo',password:'x'.repeat(3000)})).status,413); assert.equal(s.calls.length,0);
});
