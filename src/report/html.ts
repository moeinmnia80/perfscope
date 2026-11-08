import type { Finding, RouteSnapshot } from '../types.js';

export function renderHtml(data: { snapshots: RouteSnapshot[]; findings: Finding[] }): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>perfscope</title>
<style>
:root{--bg:#0b0d12;--card:#141824;--line:#232a3b;--tx:#e6e9f2;--mut:#8b93a7;--hi:#ff5c7a;--md:#ffb454;--lo:#5cc8ff;--ac:#7c5cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px system-ui,Vazirmatn,sans-serif;display:grid;grid-template-columns:260px 1fr;min-height:100vh}
aside{border-inline-end:1px solid var(--line);padding:20px;position:sticky;top:0;height:100vh;overflow:auto}
h1{font-size:18px;margin:0 0 16px;background:linear-gradient(90deg,var(--ac),var(--lo));-webkit-background-clip:text;color:transparent}
.route{padding:10px 12px;border-radius:10px;cursor:pointer;color:var(--mut);direction:ltr;text-align:left}
.route:hover,.route.on{background:var(--card);color:var(--tx)}
main{padding:28px;max-width:1100px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.stat,.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.stat b{display:block;font-size:22px;margin-top:4px}.stat span{color:var(--mut);font-size:12px}
h2{font-size:15px;margin:28px 0 12px}
.node{margin-inline-start:16px;border-inline-start:1px dashed var(--line);padding-inline-start:10px}
.row{display:flex;gap:10px;align-items:center;padding:4px 0;cursor:pointer;direction:ltr}
.bar{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--ac),var(--lo));min-width:2px}
.meta{color:var(--mut);font-size:11px}
.sev{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;margin-inline-end:8px}
.high{background:#ff5c7a22;color:var(--hi)}.medium{background:#ffb45422;color:var(--md)}.low{background:#5cc8ff22;color:var(--lo)}
.f{margin-bottom:12px}.f code{direction:ltr;display:block;white-space:pre-wrap;background:#0b0d12;padding:10px;border-radius:8px;margin-top:8px;font-size:12px}
button{background:var(--ac);color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;margin-inline-end:6px}
@media print{aside,button{display:none}body{display:block}}
</style>
<aside><h1>perfscope</h1><div id="routes"></div>
<p><button onclick="dl('json')">JSON</button><button onclick="dl('md')">MD</button><button onclick="print()">PDF</button></p></aside>
<main id="main"></main>
<script>
const D=${json};let cur=D.snapshots.length?D.snapshots[0].route:'';
const kb=b=>(b/1024).toFixed(0)+'KB';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
function flat(n){return n.flatMap(x=>[x,...flat(x.children)])}
function tree(nodes,max){return nodes.map(n=>{
  const w=Math.max(2,(n.domNodes/max)*160);
  return '<div class="node"><div class="row" onclick="this.nextElementSibling.hidden=!this.nextElementSibling.hidden">'+
  '<b>&lt;'+esc(n.name)+'&gt;</b><div class="bar" style="width:'+w+'px"></div>'+
  '<span class="meta">'+n.domNodes+' nodes · '+n.renders+' renders'+(n.rect?' · y='+n.rect.y+' · '+n.rect.w+'×'+n.rect.h:'')+(n.aboveFold?' · above-fold':'')+'</span></div>'+
  '<div>'+tree(n.children,max)+'</div></div>'}).join('')}
function pick(r){cur=r;show()}
function show(){
  const s=D.snapshots.find(x=>x.route===cur);
  if(!s){document.getElementById('main').innerHTML='<p>No routes analyzed.</p>';return}
  const fs=D.findings.filter(f=>f.route===cur);
  const js=s.network.filter(n=>n.type==='Script').reduce((a,b)=>a+b.bytes,0);
  const max=Math.max(1,...flat(s.tree).map(n=>n.domNodes));
  document.getElementById('routes').innerHTML=D.snapshots.map((x,i)=>'<div class="route '+(x.route===cur?'on':'')+'" data-i="'+i+'">'+esc(x.route)+'</div>').join('');
  document.querySelectorAll('.route').forEach(el=>el.onclick=()=>pick(D.snapshots[el.dataset.i].route));
  document.getElementById('main').innerHTML=
  '<div class="grid">'+[['LCP',Math.round(s.vitals.lcp)+'ms'],['CLS',s.vitals.cls.toFixed(3)],['JS',kb(js)],['DOM',s.domTotal]]
   .map(([a,b])=>'<div class="stat"><span>'+a+'</span><b>'+b+'</b></div>').join('')+'</div>'+
  '<h2>Component graph</h2><div class="card">'+(s.tree.length?tree(s.tree,max):'<span class="meta">No React Fiber tree found (non-React page, Server Components only, or minified names).</span>')+'</div>'+
  '<h2>Findings ('+fs.length+')</h2>'+fs.map(f=>'<div class="card f"><span class="sev '+f.severity+'">'+f.severity+'</span><b>'+f.id+'</b> <span class="meta">'+esc(f.where)+'</span><p>'+esc(f.why)+'</p><code>'+esc(f.fix)+'</code></div>').join('');
}
function dl(t){
  const body=t==='json'?JSON.stringify(D,null,2):D.findings.map(f=>'### ['+f.severity+'] '+f.id+' — '+f.route+'\\n**where:** '+f.where+'\\n\\n'+f.why+'\\n\\n'+f.fix).join('\\n\\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body]));a.download='perfscope.'+t;a.click();
}
show();
</script></html>`;
}
