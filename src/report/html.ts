import type { Finding, RouteSnapshot } from '../types.js';

// NOTE: CSS and CLIENT are String.raw templates -> never put a backtick or "${" inside them.
// (A backtick in the client code is written as \x60.)

const CSS = String.raw`
:root{--bg:#f4f5f7;--panel:#fff;--line:#e3e6ec;--tx:#0f172a;--mut:#64748b;--ac:#4f46e5;
--good:#0cce6b;--goodbg:#e5f9ef;--mid:#ffa400;--midbg:#fff3d9;--bad:#ff4e42;--badbg:#ffebe9;
--code:#f1f3f7;--addbg:#e6f7ee;--addtx:#05603a;--delbg:#fdebe9;--deltx:#b42318;color-scheme:light}
:root[data-theme=dark]{--bg:#0d1117;--panel:#161b22;--line:#2a313c;--tx:#e6edf3;--mut:#8b98a9;--ac:#8b8dff;
--goodbg:#0f2a1d;--midbg:#2e2410;--badbg:#341716;--code:#0d1117;--addbg:#0f2a1d;--addtx:#6fe3a5;--delbg:#341716;--deltx:#ff9b92;color-scheme:dark}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--panel:#161b22;--line:#2a313c;--tx:#e6edf3;--mut:#8b98a9;--ac:#8b8dff;
--goodbg:#0f2a1d;--midbg:#2e2410;--badbg:#341716;--code:#0d1117;--addbg:#0f2a1d;--addtx:#6fe3a5;--delbg:#341716;--deltx:#ff9b92;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Vazirmatn,sans-serif}
.good{--c:var(--good);--cb:var(--goodbg)}.mid{--c:var(--mid);--cb:var(--midbg)}.bad{--c:var(--bad);--cb:var(--badbg)}
.app{display:grid;grid-template-columns:272px minmax(0,1fr);min-height:100vh}
aside{background:var(--panel);border-inline-end:1px solid var(--line);padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto}
.brand{font-weight:700;font-size:17px;padding:0 8px 14px;display:flex;align-items:center;gap:8px}
.brand i{width:22px;height:22px;border-radius:7px;background:conic-gradient(var(--good) 0 40%,var(--mid) 0 70%,var(--bad) 0);display:inline-block}
.nav-t{color:var(--mut);font-size:12px;padding:6px 8px}
.route{display:flex;align-items:center;gap:10px;width:100%;text-align:left;direction:ltr;background:none;border:0;color:var(--tx);padding:8px;border-radius:10px;cursor:pointer;font:inherit}
.route:hover{background:var(--bg)}.route.on{background:var(--bg);box-shadow:inset 3px 0 0 var(--ac)}
.route span.p{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;border:2px solid var(--c);color:var(--c);background:var(--cb);flex:none}
.tools{display:flex;flex-wrap:wrap;gap:6px;padding:14px 8px 0}
button.b{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;font-size:12px}
button.b:hover{border-color:var(--ac)}
main{padding:28px clamp(16px,4vw,40px) 60px;max-width:1040px;width:100%}
.hero{display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px}
.gauge{position:relative;width:var(--s);height:var(--s);flex:none}
.gauge svg{transform:rotate(-90deg);width:100%;height:100%}
.gauge .bg{fill:var(--cb);stroke:var(--line);stroke-width:8}
.gauge .fg{fill:none;stroke:var(--c);stroke-width:8;stroke-linecap:round}
.gauge b{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--s)*.34);color:var(--c);font-weight:600}
.hero h1{margin:0;font-size:20px;direction:ltr;word-break:break-all}
.hero p{margin:4px 0 0;color:var(--mut);max-width:60ch}
.legend{display:flex;gap:14px;margin-top:12px;color:var(--mut);font-size:12px;flex-wrap:wrap}
.legend span::before{content:"";display:inline-block;margin-inline-end:5px;vertical-align:-1px}
.legend .l1::before{width:0;height:0;border:5px solid transparent;border-bottom:9px solid var(--bad);border-top:0}
.legend .l2::before{width:9px;height:9px;background:var(--mid)}
.legend .l3::before{width:10px;height:10px;border-radius:50%;background:var(--good)}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0 8px}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;border-top:3px solid var(--c)}
.metric span{color:var(--mut);font-size:12px}.metric b{display:block;font-size:22px;font-weight:600;color:var(--c);margin-top:2px}
.metric small{color:var(--mut);font-size:11px}
h2{font-size:16px;margin:32px 0 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.chips{display:flex;gap:6px;margin-inline-start:auto}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--tx);border-radius:99px;padding:3px 11px;font:inherit;font-size:12px;cursor:pointer}
.chip.on{background:var(--tx);color:var(--bg);border-color:var(--tx)}
.audit{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden}
.audit>summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;padding:13px 16px}
.audit>summary::-webkit-details-marker{display:none}
.audit>summary::after{content:"";width:8px;height:8px;border-right:2px solid var(--mut);border-bottom:2px solid var(--mut);transform:rotate(45deg);margin-inline-start:6px;transition:transform .15s}
.audit[open]>summary::after{transform:rotate(225deg)}
.audit[open]>summary{border-bottom:1px solid var(--line)}
.ico{flex:none;width:12px;height:12px}
.high .ico{width:0;height:0;border:7px solid transparent;border-bottom:12px solid var(--bad);border-top:0}
.medium .ico{background:var(--mid);width:11px;height:11px}
.low .ico{background:var(--mut);border-radius:50%;width:11px;height:11px}
.ttl{font-weight:600;flex:1}
.pill{font-size:11px;padding:1px 8px;border-radius:99px;background:var(--bg);border:1px solid var(--line);color:var(--mut)}
.pill.bad{background:var(--badbg);color:var(--bad);border-color:transparent}
.cnt{color:var(--mut);font-size:12px}
.sevl{font-size:11px;font-weight:600;padding:1px 8px;border-radius:6px}
.high .sevl{background:var(--badbg);color:var(--bad)}.medium .sevl{background:var(--midbg);color:#b86e00}.low .sevl{background:var(--bg);color:var(--mut)}
.abody{padding:16px}
.rec{margin:0 0 14px;font-weight:500}
.steps{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:8px}
.steps li{display:flex;gap:10px;align-items:baseline}
.st{flex:none;min-width:70px;text-align:center;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px}
.st.remove{background:var(--delbg);color:var(--deltx)}.st.add{background:var(--addbg);color:var(--addtx)}
.st.replace{background:var(--midbg);color:#b86e00}.st.check{background:var(--bg);color:var(--mut);border:1px solid var(--line)}
code{background:var(--code);padding:1px 5px;border-radius:5px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.instd{border:1px solid var(--line);border-radius:10px;margin-top:8px}
.instd>summary{cursor:pointer;padding:9px 12px;direction:ltr;font:12px ui-monospace,Menlo,monospace}
.inst{padding:12px;display:grid;gap:8px}
.inst .k{font-size:11px;font-weight:600;color:var(--mut);margin-top:4px}
.where{direction:ltr;text-align:left;font:12.5px ui-monospace,Menlo,monospace;word-break:break-all}
.why{margin:0;color:var(--tx)}
.ba{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:720px){.ba{grid-template-columns:1fr}}
.cb{border-radius:10px;overflow:hidden;border:1px solid var(--line);min-width:0}
.cb header{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;font-size:11px;font-weight:700;background:var(--code)}
.cb.del header{background:var(--delbg);color:var(--deltx)}.cb.add header{background:var(--addbg);color:var(--addtx)}
.cb header button{background:none;border:0;color:inherit;cursor:pointer;font:inherit;opacity:.8}
pre{margin:0;padding:10px 12px;overflow:auto;direction:ltr;text-align:left;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);white-space:pre}
.cb.del pre{background:color-mix(in srgb,var(--delbg) 45%,var(--code))}.cb.add pre{background:color-mix(in srgb,var(--addbg) 45%,var(--code))}
.ok{background:var(--goodbg);color:var(--addtx);border-radius:12px;padding:16px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tsearch{width:100%;margin-bottom:10px;border:1px solid var(--line);background:var(--bg);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;direction:ltr}
.trow{display:flex;align-items:center;gap:10px;padding:4px 2px;cursor:pointer;direction:ltr;border-radius:6px}
.trow:hover{background:var(--bg)}
.tog{width:12px;color:var(--mut);flex:none}
.tbar{flex:0 0 90px;height:5px;background:var(--bg);border-radius:3px;overflow:hidden}.tbar i{display:block;height:100%;background:var(--ac)}
.tmeta{color:var(--mut);font-size:11px}
.tkids{margin-inline-start:12px;padding-inline-start:10px;border-inline-start:1px dashed var(--line)}
.empty{color:var(--mut)}
@media(max-width:860px){.app{display:block}aside{position:static;height:auto}}
@media print{aside,.chips,.tools,.tsearch{display:none}.app{display:block}.audit,.instd{break-inside:avoid}}
`;

const CLIENT = String.raw`
const $=(s)=>document.querySelector(s);
const h=(tag,a,...kids)=>{const e=document.createElement(tag);for(const k in(a||{})){const v=a[k];if(v==null||v===false)continue;
 if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v)}
 for(const c of kids.flat()){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)))}return e};
const TICK='\x60';
const rich=(t)=>t.split(TICK).map((p,i)=>i%2?h('code',{},p):p);
const SEV={high:3,medium:2,low:1};
const KIND={remove:'Remove',add:'Add',replace:'Replace',check:'Check'};
const kb=(b)=>(b/1024).toFixed(0)+' KB';
const grade=(n)=>n>=90?'good':n>=50?'mid':'bad';
const mg=(v,g,p)=>v<=g?'good':v<=p?'mid':'bad';
const sc=(v,g,p)=>v<=g?100-10*v/g:v<=p?90-40*(v-g)/(p-g):Math.max(0,50-50*(v-p)/p);
const score=(v)=>Math.round(.35*sc(v.lcp,2500,4000)+.35*sc(v.tbt,200,600)+.3*sc(v.cls,.1,.25));
let cur=D.snapshots.length?D.snapshots[0].route:'';let filter='all';

function gauge(n,size){
 const r=size/2-6,c=2*Math.PI*r,w=h('div',{class:'gauge '+grade(n),style:'--s:'+size+'px'});
 w.innerHTML='<svg viewBox="0 0 '+size+' '+size+'"><circle class="bg" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'"/><circle class="fg" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke-dasharray="'+(c*n/100)+' '+c+'"/></svg><b>'+n+'</b>';
 return w}
function copy(t,btn){if(navigator.clipboard)navigator.clipboard.writeText(t);const o=btn.textContent;btn.textContent='Copied';setTimeout(()=>{btn.textContent=o},1100)}
function codeBox(label,text,cls){
 const btn=h('button',{type:'button'},'Copy');btn.addEventListener('click',()=>copy(text,btn));
 return h('div',{class:'cb '+(cls||'')},label&&h('header',{},h('span',{},label),btn),h('pre',{},text))}
function inst(f){
 return h('div',{class:'inst'},
  h('p',{class:'why'},f.why),
  h('div',{class:'k'},'Where'),h('div',{class:'where'},f.where),
  f.asset&&[h('div',{class:'k'},'File'),h('div',{class:'where'},f.asset)],
  f.evidence&&[h('div',{class:'k'},'What was found on the page'),codeBox(null,f.evidence)],
  (f.before||f.after)&&h('div',{class:'ba'},f.before&&codeBox('Before (now)',f.before,'del'),f.after&&codeBox('After (fix)',f.after,'add')))}
function audit(g){
 const f=g[0],sev=g.reduce((a,x)=>SEV[x.severity]>SEV[a]?x.severity:a,'low');
 return h('details',{class:'audit '+sev},
  h('summary',{},h('span',{class:'ico'}),h('span',{class:'ttl'},f.title),f.impact&&h('span',{class:'pill'},f.impact),
   h('span',{class:'cnt'},g.length>1?g.length+' places':'1 place'),h('span',{class:'sevl'},sev)),
  h('div',{class:'abody'},
   h('p',{class:'rec'},rich(f.fix)),
   f.steps&&h('ul',{class:'steps'},f.steps.map((s)=>h('li',{},h('span',{class:'st '+s.kind},KIND[s.kind]),h('span',{},rich(s.text))))),
   g.length===1?inst(f):g.map((x,i)=>h('details',{class:'instd',open:i===0?'':null},h('summary',{},x.where),inst(x)))))}
function groups(fs){
 const m=new Map();for(const f of fs){if(!m.has(f.id))m.set(f.id,[]);m.get(f.id).push(f)}
 return[...m.values()].sort((a,b)=>Math.max(...b.map(x=>SEV[x.severity]))-Math.max(...a.map(x=>SEV[x.severity]))||b.length-a.length)}
function flat(n){return n.flatMap((x)=>[x,...flat(x.children)])}
function tree(nodes,max,depth,q){
 return nodes.map((n)=>{
  const kids=n.children.length;
  const tog=h('span',{class:'tog'},kids?(depth>=2?'▸':'▾'):'·');
  const box=h('div',{class:'tkids'},tree(n.children,max,depth+1,q));box.hidden=depth>=2&&!q;
  const row=h('div',{class:'trow'},tog,h('b',{},'<'+n.name+'>'),h('span',{class:'tbar'},h('i',{style:'width:'+Math.max(3,n.domNodes/max*100)+'%'})),
   h('span',{class:'tmeta'},n.domNodes+' nodes'),n.renders>15&&h('span',{class:'pill bad'},n.renders+' renders'),n.aboveFold&&h('span',{class:'pill'},'above the fold'));
  row.addEventListener('click',()=>{box.hidden=!box.hidden;tog.textContent=kids?(box.hidden?'▸':'▾'):'·'});
  return h('div',{},row,kids?box:null)})}
function navList(){
 const el=$('#routes');el.replaceChildren();
 D.snapshots.forEach((x)=>{const n=score(x.vitals),c=D.findings.filter((f)=>f.route===x.route).length;
  const b=h('button',{class:'route'+(x.route===cur?' on':''),type:'button',title:c+' findings'},h('span',{class:'mini '+grade(n)},n),h('span',{class:'p'},x.route));
  b.addEventListener('click',()=>{cur=x.route;filter='all';render()});el.append(b)})}
function render(){
 navList();const main=$('#main');main.replaceChildren();
 const s=D.snapshots.find((x)=>x.route===cur);
 if(!s){main.append(h('p',{class:'empty'},'No routes were analyzed.'));return}
 const all=D.findings.filter((f)=>f.route===cur),fs=all.filter((f)=>filter==='all'||f.severity===filter);
 const v=s.vitals,n=score(v),js=s.network.filter((x)=>x.type==='Script').reduce((a,b)=>a+b.bytes,0);
 const cnt=(k)=>all.filter((f)=>f.severity===k).length;
 main.append(
  h('section',{class:'hero'},gauge(n,128),h('div',{},h('h1',{},s.route),h('p',{},s.url),
   h('p',{},'Estimated performance score from LCP, TBT and CLS on this route. It is a quick guide, not an official Lighthouse score.'),
   h('div',{class:'legend'},h('span',{class:'l1'},'0–49 poor'),h('span',{class:'l2'},'50–89 needs work'),h('span',{class:'l3'},'90–100 good')))),
  h('section',{class:'metrics'},
   [['Largest Contentful Paint',(v.lcp/1000).toFixed(2)+' s',mg(v.lcp,2500,4000),'good ≤ 2.5 s'],
    ['Cumulative Layout Shift',v.cls.toFixed(3),mg(v.cls,.1,.25),'good ≤ 0.1'],
    ['Total Blocking Time',Math.round(v.tbt)+' ms',mg(v.tbt,200,600),'good ≤ 200 ms'],
    ['JavaScript downloaded',kb(js),mg(js,300*1024,600*1024),'good ≤ 300 KB'],
    ['DOM elements',String(s.domTotal),mg(s.domTotal,1500,3000),'good ≤ 1500']]
   .map(([a,b,g,t])=>h('div',{class:'metric '+g},h('span',{},a),h('b',{},b),h('small',{},t)))),
  h('h2',{},'Findings',h('span',{class:'pill'},all.length),
   h('span',{class:'chips'},['all','high','medium','low'].map((k)=>{const c=h('button',{class:'chip'+(filter===k?' on':''),type:'button'},k==='all'?'All':k+' ('+cnt(k)+')');c.addEventListener('click',()=>{filter=k;render()});return c}))),
  fs.length?groups(fs).map(audit):h('div',{class:'ok'},all.length?'No findings with this severity.':'Nothing to fix on this route. Nice work.'));
 const max=Math.max(1,...flat(s.tree).map((x)=>x.domNodes));
 const holder=h('div',{});
 const draw=(q)=>{holder.replaceChildren();
  const list=q?flat(s.tree).filter((x)=>x.name.toLowerCase().includes(q)).map((x)=>({...x,children:[]})):s.tree;
  holder.append(...(list.length?tree(list,max,0,q):[h('span',{class:'empty'},'No component matches.')]))};
 const search=h('input',{class:'tsearch',placeholder:'Search components…',type:'search'});
 search.addEventListener('input',()=>draw(search.value.trim().toLowerCase()));
 draw('');
 main.append(h('h2',{},'Component graph'),
  h('div',{class:'card'},s.tree.length?[search,holder]:h('span',{class:'empty'},'No React component tree was found. The page may not use React, may use only Server Components, or the names are minified. Build once with "next build --no-mangling" for readable names.')))}
function save(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text]));a.download=name;a.click()}
function markdown(){
 return D.findings.map((f)=>'### ['+f.severity+'] '+f.title+' — '+f.route+'\n**Where:** '+f.where+'\n\n'+f.why+'\n\n'+
  (f.steps||[]).map((s)=>'- **'+KIND[s.kind]+':** '+s.text).join('\n')+
  (f.before?'\n\nBefore:\n\x60\x60\x60\n'+f.before+'\n\x60\x60\x60':'')+(f.after?'\n\nAfter:\n\x60\x60\x60\n'+f.after+'\n\x60\x60\x60':'')).join('\n\n---\n\n')}
$('#bj').addEventListener('click',()=>save('perfscope.json',JSON.stringify(D,null,2)));
$('#bm').addEventListener('click',()=>save('perfscope.md',markdown()));
$('#bp').addEventListener('click',()=>print());
$('#bt').addEventListener('click',()=>{const r=document.documentElement,dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark'});
render();
`;

export function renderHtml(data: { snapshots: RouteSnapshot[]; findings: Finding[] }): string {
  // "<" is escaped so the JSON can never close the <script> tag
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>perfscope report</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand"><i></i>perfscope</div>
    <div class="nav-t">Routes</div>
    <div id="routes"></div>
    <div class="tools">
      <button class="b" id="bj" type="button">JSON</button>
      <button class="b" id="bm" type="button">Markdown</button>
      <button class="b" id="bp" type="button">PDF</button>
      <button class="b" id="bt" type="button">Theme</button>
    </div>
  </aside>
  <main id="main"></main>
</div>
<script>
const D=${json};
${CLIENT}
</script>
</body>
</html>`;
}
