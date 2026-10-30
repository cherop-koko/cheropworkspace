// Deterministic assembly only. No model calls, invented product facts or publication.
export const VERSION='1.0.0';
export const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class EvidenceError extends Error{}
export function validate(input){
 const errors=[];
 if(input?.schemaVersion!==1) errors.push('입력 양식 버전');
 if(!input?.template?.html || !input?.template?.id) errors.push('승인 기본틀');
 if(input?.evidence?.productConfirmed!==true) errors.push('상품·규격·옵션 확인');
 if(input?.evidence?.assetsConfirmed!==true) errors.push('상품별 이미지 대조');
 if(!input?.evidence?.source || !input?.evidence?.reviewer) errors.push('확인 출처·검수자');
 const html=input?.template?.html||'';
 if(/<script\b|\son\w+\s*=|<iframe\b|javascript:/i.test(html)) errors.push('실행 코드가 포함된 템플릿');
 if(html.length>3000000) errors.push('템플릿 크기');
 const slots=[...html.matchAll(/\{\{(text|asset):([\w-]+)\}\}/g)];
 const assets=input?.assets||{},texts=input?.texts||{};
 let bytes=0;
 for(const [,type,key] of slots){
  const v=type==='text'?texts[key]:assets[key];
  if(typeof v!=='string'||!v.length) {errors.push(`${type}:${key} 누락`);continue;}
  if(type==='asset'){
   if(!/^assets\/a[0-9]+\.(png|jpg|gif|webp|woff2)$/.test(v)&&!/^data:(image\/(png|jpeg|gif|webp)|font\/woff2);base64,[A-Za-z0-9+/=]+$/.test(v)) errors.push(`${key} 이미지/폰트 형식`);
   bytes+=v.length;
  }
 }
 if(bytes>65000000) errors.push('결과 용량 65MB 초과');
 const text=Object.values(texts).join(' ')+html.replace(/<style[\s\S]*?<\/style>/gi,'');
 if(/0세|신생아|KC 안전기준/.test(text)&&input?.evidence?.kcConfirmed!==true) errors.push('모델별 KC·사용연령 증빙');
 if(errors.length) throw new EvidenceError([...new Set(errors)].join(' / '));
 return {slots:slots.length,assets:new Set(slots.filter(x=>x[1]==='asset').map(x=>x[2])).size};
}
export function render(input){
 const checks=validate(input);
 // Use a replacement callback so $&, dollar signs and braces in copy stay literal.
 const html=input.template.html.replace(/\{\{(text|asset):([\w-]+)\}\}/g,(_,type,key)=>type==='text'?escapeHTML(input.texts[key]):input.assets[key]);
 return {html,report:{rendererVersion:VERSION,template:input.template.id,checks,visualReview:'pending',publication:'not_published',source:input.evidence.source,reviewer:input.evidence.reviewer}};
}
