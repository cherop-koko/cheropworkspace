import test from 'node:test';import assert from 'node:assert/strict';import {render,validate,EvidenceError} from '../../production-engine/renderer.mjs';
const base=()=>({schemaVersion:1,template:{id:'test',html:'<h1>{{text:title}}</h1><img src="{{asset:hero}}">'},texts:{title:'몽모'},assets:{hero:'data:image/png;base64,YQ=='},evidence:{productConfirmed:true,assetsConfirmed:true,source:'official',reviewer:'test'}});
test('escapes copy and preserves replacement dollars',()=>{let b=base();b.texts.title='<script>$&</script>';assert.ok(render(b).html.includes('&lt;script&gt;$&'));});
test('missing assets block, never substitute another character',()=>{let b=base();delete b.assets.hero;assert.throws(()=>validate(b),EvidenceError);});
test('KC is not inherited without specific evidence',()=>{let b=base();b.texts.title='신생아 0세 이상';assert.throws(()=>validate(b),/KC/);b.evidence.kcConfirmed=true;assert.doesNotThrow(()=>validate(b));});
test('external and active assets rejected',()=>{let b=base();b.assets.hero='https://evil.example/a.png';assert.throws(()=>validate(b));b=base();b.template.html+='<script>alert(1)</script>';assert.throws(()=>validate(b));});
test('no inferred verification',()=>{let b=base();b.evidence.productConfirmed=false;assert.throws(()=>validate(b));});
