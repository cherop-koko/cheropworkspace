const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const d=new JSDOM('<div class="main"></div><div id="ws-navigation"><nav></nav></div><div class="tb-nav"></div>',{url:'https://example.test/#ai-team',runScripts:'outside-only'}),w=d.window;
w.parseHash=()=>({page:'home',sub:''});w.renderPage=page=>w.document.querySelectorAll('.page').forEach(n=>n.classList.toggle('on',n.id==='page-'+page));
let resolveFetch;w.fetch=()=>new Promise(r=>resolveFetch=r);
w.db={from:()=>({select:()=>({eq:(key,id)=>({single:async()=>({data:{data:{tasks:[],updatedAt:'2026-10-30'}}}),maybeSingle:async()=>({data:{data:id==='cherop_production_previews'?{jobs:{abc:{previewURL:'https://chatgpt.com/library?file_id=test&account_id=personal'}}}:{jobs:[{id:'abc',title:'<img src=x onerror=alert(1)>',product_key:'K01',status:'review',stage:'초안',created_at:'2026-10-30',output_path:'private.zip'},{id:'cancel',title:'old test',status:'cancelled'}]},updated_at:'2026-10-30'}})})})})};
const ai=fs.readFileSync('workspace-ai-team.js','utf8').split('/* Grouped navigation')[0];w.eval(ai);w.eval(fs.readFileSync('workspace-production-engine.js','utf8'));
w.renderPage('ai-team','lead');assert.ok(w.document.querySelector('.ai-work-tabs a[href="#ai-team/production"]'));
w.history.replaceState(null,'','#ai-team/production');w.renderPage('ai-team','production');await new Promise(r=>setTimeout(r,20));
assert.equal(w.parseHash().sub,'production');assert.ok(w.document.querySelector('#page-ai-team').classList.contains('on'));assert.equal(w.document.querySelectorAll('.pe-table tbody tr').length,1);
assert.equal(w.document.querySelectorAll('#page-ai-team img').length,0);assert.equal(w.document.querySelectorAll('#ws-navigation a[href*="production"]').length,0);assert.ok(w.document.querySelector('.pe-preview').href.startsWith('https://chatgpt.com/library'));
resolveFetch({ok:true,json:async()=>({schemaVersion:1,tasks:[],updatedAt:'2026-10-30'})});await new Promise(r=>setTimeout(r,10));assert.ok(w.document.querySelector('.pe-table'),'late org response must not overwrite production');
w.document.querySelector('[data-pe-filter="all"]').click();assert.equal(w.document.querySelectorAll('.pe-table tbody tr').length,2);
w.history.replaceState(null,'','#production-engine');assert.equal(w.parseHash().sub,'production');assert.equal(w.location.hash,'#ai-team/production');
w.history.replaceState(null,'','#ai-team');w.renderPage('ai-team','lead');assert.ok(w.document.querySelector('.ai-org-grid'));assert.equal(w.document.querySelector('.pe-table'),null);
w.close();console.log('PASS nested tab, old route, org return, late-response race, escaping, previews, no sidebar duplicate');
})().catch(e=>{console.error(e);process.exitCode=1});
