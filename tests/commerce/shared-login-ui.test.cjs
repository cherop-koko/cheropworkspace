const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
function fixture() {
  let session = null;
  const subscribers = [], requests = [], configs = [], windows = [];
  function page(verification = false) {
    const dom = new JSDOM(read(verification ? 'sales-verification.html' : 'index.html'), { url: 'https://cherop-koko.github.io/cheropworkspace/' + (verification ? 'sales-verification.html' : 'index.html'), runScripts: 'outside-only' });
    const w = dom.window; windows.push(w); w.setInterval = () => 0;
    w.CHEROPCommerceConfig = { url: 'https://db.example.test', publishableKey: 'synthetic-public', api: 'https://db.example.test/functions/v1/commerce-api' };
    const emit = event => subscribers.forEach(fn => fn(event));
    w.supabase = { createClient: (url, key, options) => {
      configs.push(options);
      return { auth: {
        getSession: async () => ({data:{session}}),
        setSession: async value => { session=value; emit('SIGNED_IN'); return {error:null}; },
        signOut: async () => { session=null; emit('SIGNED_OUT'); return {error:null}; },
        onAuthStateChange: fn => {subscribers.push(fn); return {data:{subscription:{unsubscribe(){}}}};}
      }, from: () => { throw Error('Login must not query business tables'); } };
    } };
    w.fetch = async (url, options = {}) => {
      const route = new URL(url).pathname; requests.push(route);
      const json = (body, status=200) => ({ok:status<400,status,json:async()=>body});
      const identity = token => token === 'Bearer verified-ceo' ? {id:'ceo',admin:true} : token === 'Bearer verified-hyunjin' ? {id:'hyunjin',admin:false} : null;
      if (route.endsWith('/workspace-auth/login')) {
        const body=JSON.parse(options.body);
        if (body.password !== 'Synthetic-only-password-29') return json({error:'INVALID_LOGIN'},401);
        return json({session:{access_token:'verified-'+body.member_id,refresh_token:'synthetic-refresh'}});
      }
      if (route.endsWith('/workspace-auth/session')) {
        const profile=identity(options.headers.Authorization); return profile ? json({profile}) : json({error:'SIGN_IN_REQUIRED'},401);
      }
      if (!identity(options.headers?.Authorization)?.admin) return json({error:'ACCESS_DENIED'},403);
      if (route.endsWith('/status')) return json({actor:{role:'admin'},credentials_present:true,capabilities:{comparison:true,connection_check:true,manual_advance:true},channel:{},checks:[]});
      if (route.endsWith('/report')) return json({from:'2026-10-01',to:'2026-10-02',coverage:'not_collected',summary:{},buckets:[]});
      if (route.endsWith('/comparison')) return json({rows:2,amount:5000,buckets:[]});
      throw Error('Unexpected call '+route);
    };
    w.eval(read('workspace-auth-client.js'));
    if (verification) w.eval(read('commerce-sales.js'));
    else {
      w.eval(read('workspace-core.js'));
      vm.runInContext("startApp = function(){ window.started=(window.started||0)+1; $('login').style.display='none'; $('app').classList.add('on'); };",dom.getInternalVMContext());
    }
    return dom;
  }
  return { page, requests, configs, setSession:value=>{session=value;}, close:()=>windows.forEach(w=>w.close()) };
}
test('existing member login opens the verification page using the same server session', async () => {
  const f=fixture(); try {
    const main=f.page(), w=main.window; await w.boot(); w.selMember('ceo');
    w.document.getElementById('pin-input').value='Synthetic-only-password-29'; await w.doLogin(); await settle();
    assert.equal(w.started,1); assert.equal(w.document.getElementById('commerce-entry').hidden,false);
    assert.equal(w.document.getElementById('pin-input').value,'');
    const verification=f.page(true); await settle();
    assert.equal(verification.window.document.getElementById('connected-panel').hidden,false);
    assert.equal(verification.window.document.getElementById('login-form'),null);
    assert.equal(verification.window.document.getElementById('manual-amount').textContent,'5,000원');
    assert.equal(f.requests.filter(x=>x.endsWith('/workspace-auth/login')).length,1);
    assert(f.configs.every(x=>x.auth.storageKey==='cherop-workspace-auth-v1'&&x.auth.persistSession));
  } finally {f.close();}
});
test('legacy browser marker and forged stored token cannot resume the workspace', async () => {
  for (const token of [null,{access_token:'forged',refresh_token:'forged'}]) {
    const f=fixture(); try {
      f.setSession(token); const dom=f.page(), w=dom.window;
      w.sessionStorage.setItem('cherop_uid','ceo'); await w.boot();
      assert.equal(w.started,undefined); assert.equal(w.document.getElementById('app').classList.contains('on'),false);
      assert.equal(w.sessionStorage.getItem('cherop_uid'),null);
      assert(!f.requests.some(x=>x.includes('commerce-api')));
    } finally {f.close();}
  }
});
test('existing employee login remains usable but cannot open the new revenue data', async () => {
  const f=fixture(); try {
    const main=f.page(),w=main.window; await w.boot();w.selMember('hyunjin');
    w.document.getElementById('pin-input').value='Synthetic-only-password-29';await w.doLogin();await settle();
    assert.equal(w.started,1);assert.equal(w.document.getElementById('commerce-entry').hidden,true);
    const verification=f.page(true);await settle();
    assert.equal(verification.window.document.getElementById('connected-panel').hidden,true);
    assert(!f.requests.some(x=>x.includes('commerce-api')));
  } finally {f.close();}
});
test('logout in either page clears verification values and invalidated sessions stay hidden', async () => {
  const f=fixture(); try {
    f.setSession({access_token:'verified-ceo',refresh_token:'synthetic'});
    const a=f.page(true),b=f.page(true);await settle();
    assert.equal(a.window.document.getElementById('connected-panel').hidden,false);
    await a.window.CHEROPWorkspaceAuth.logout(); await settle();
    for (const dom of [a,b]) {
      assert.equal(dom.window.document.getElementById('connected-panel').hidden,true);
      assert.equal(dom.window.document.getElementById('manual-amount').textContent,'—');
      assert.equal(dom.window.document.getElementById('daily').children.length,0);
    }
  } finally {f.close();}
});
