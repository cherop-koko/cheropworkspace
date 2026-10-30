const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const d=new JSDOM('<div class="main"></div><div id="ws-navigation"><nav></nav></div><div class="tb-nav"></div>',{url:'https://example.test/#production-engine',runScripts:'outside-only'}),w=d.window;
w.parseHash=()=>({page:'home'});w.renderPage=()=>{};
w.db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{data:{jobs:[{id:'abc',title:'<img src=x onerror=alert(1)>',product_key:'K01',status:'review',stage:'초안',created_at:'2026-10-30',output_path:'private.zip'}]},updated_at:'now'}})})})})};
w.eval(fs.readFileSync('workspace-production-engine.js','utf8'));assert.equal(w.parseHash().page,'production-engine');w.renderPage('production-engine');await new Promise(r=>setTimeout(r,20));
assert.ok(w.document.querySelector('#page-production-engine').textContent.includes('검수 대기'));
assert.equal(w.document.querySelectorAll('#page-production-engine img').length,0);
assert.equal(w.document.querySelectorAll('a[href="#production-engine"]').length,1);
assert.ok(!w.document.querySelector('#page-production-engine').innerHTML.includes('href="private.zip"'));
w.close();console.log('PASS production UI routing, projection, escaping and private output protection');
})();
