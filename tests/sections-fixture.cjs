// Synthetic records only; production company data is never committed.
const projects=Array.from({length:6},(_,i)=>({id:'p'+i,title:'검증 프로젝트 '+i,status:'ing',start_date:'2026-10-01',end_date:'2026-10-31'}));
const proj_tasks=Array.from({length:146},(_,i)=>({id:'t'+i,title:'검증 업무 '+i,status:i%3?'todo':'done',proj_id:'p'+i%6,assignee:'테스트직원',due_date:'2026-10-17'}));
const plan=Object.fromEntries([[2023,3],[2024,18],[2025,45],[2026,30]].map(([year,count])=>[year,{products:Array.from({length:count},(_,i)=>({id:'product-'+year+'-'+i,name:'검증 상품 '+i,cat:'프렌즈',month:10,launch:year+'-10',status:'launched',price:1000,imgs:{},sizes:[],colors:[]}))}]));
const assets=Array.from({length:11},(_,i)=>({id:'a'+i,name:'검증 자료 '+i,cat:'cat-brand',tags:[],links:[{url:'https://example.com/',label:'자료'}]}));
const ops_events=Array.from({length:92},(_,i)=>({id:'e'+i,title:'검증 일정 '+i,cat:i<5?'cat-general':i<10?'cat-popup':i<22?'cat-open':'cat-incoming',startDate:'2026-10-'+String(1+i%28).padStart(2,'0'),endDate:'2026-10-'+String(1+i%28).padStart(2,'0'),status:'planned'}));
module.exports={projects,proj_tasks,plan,assets,asset_cats:[{id:'cat-brand',name:'브랜드'}],ops_events,ops_orders:[],ops_cats:[],tpl_popup:[]};
