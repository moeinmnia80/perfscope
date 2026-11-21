export const css = /* css */ `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.ps { --ink:#0d0d0e; --panel:#161617; --paper:#f4f0e6; --dim:#a3a09a; --line:rgba(255,255,255,.11);
  --accent:#ff5d57; --high:#ff5d57; --med:#ffc247; --low:#6ea8ff; --ok:#4fd8c4;
  font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--paper); letter-spacing:.01em;
  position: fixed; z-index: 2147483000; }
:where(.ps) button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
.ps button:focus-visible, .ps input:focus-visible, .ps summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ps[data-corner="bottom-right"] { right: 16px; bottom: 16px; }
.ps[data-corner="bottom-left"] { left: 16px; bottom: 16px; }
.ps[data-corner="top-right"] { right: 16px; top: 16px; }
.ps[data-corner="top-left"] { left: 16px; top: 16px; }

/* ------------------------------------------------ launcher: one small rectangle */
.launch { position: relative; display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px 0 9px;
  background: var(--ink); border: 1px solid var(--line); color: var(--paper); text-transform: uppercase; font-size: 10.5px; letter-spacing: .12em;
  box-shadow: 0 6px 24px rgba(0,0,0,.45); transition: border-color .2s, transform .2s, opacity .2s; }
.launch:hover { border-color: var(--accent); }
.launch .bars { display: grid; grid-auto-flow: column; align-items: end; gap: 2px; height: 12px; }
.launch .bars i { display: block; width: 3px; background: var(--accent); transform-origin: bottom; }
.launch .bars i:nth-child(1) { height: 5px; } .launch .bars i:nth-child(2) { height: 12px; } .launch .bars i:nth-child(3) { height: 8px; }
.launch .badge { min-width: 16px; padding: 1px 4px; background: var(--accent); color: #1a0200; font-weight: 700; text-align: center; letter-spacing: 0; }
.launch .badge[data-sev="medium"] { background: var(--med); } .launch .badge[data-sev="ok"] { background: var(--ok); } .launch .badge[data-sev="busy"] { background: var(--line); color: var(--dim); }
.launch[data-scanning="true"] .bars i { animation: bar 0.9s ease-in-out infinite alternate; }
.launch[data-scanning="true"] .bars i:nth-child(2) { animation-delay: .15s; } .launch[data-scanning="true"] .bars i:nth-child(3) { animation-delay: .3s; }
@keyframes bar { from { transform: scaleY(.35); } to { transform: scaleY(1); } }
.ps[data-open="true"] .launch { opacity: 0; pointer-events: none; transform: scale(.9); }

/* ------------------------------------------------ panel: grows out of the launcher */
.panel { position: absolute; width: min(460px, calc(100vw - 24px)); height: min(640px, calc(100vh - 32px)); display: flex; flex-direction: column;
  background: var(--ink); border: 1px solid var(--line); box-shadow: 0 30px 90px rgba(0,0,0,.6); overflow: hidden;
  clip-path: var(--from); visibility: hidden; transition: clip-path .62s cubic-bezier(.65,0,.15,1), visibility 0s .62s; }
.ps[data-corner="bottom-right"] .panel { right: 0; bottom: 0; } .ps[data-corner="bottom-left"] .panel { left: 0; bottom: 0; }
.ps[data-corner="top-right"] .panel { right: 0; top: 0; } .ps[data-corner="top-left"] .panel { left: 0; top: 0; }
.ps[data-open="true"] .panel { clip-path: inset(0 0 0 0); visibility: visible; transition: clip-path .62s cubic-bezier(.65,0,.15,1), visibility 0s; }
.panel > * { opacity: 0; transition: opacity .25s; }
.ps[data-open="true"] .panel > * { opacity: 1; transition: opacity .35s .3s; }
.scan { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 30%, transparent), transparent); height: 30%; transform: translateY(-120%); opacity: 0; }
.ps[data-open="true"] .scan { animation: sweep .9s .1s cubic-bezier(.65,0,.15,1) both; }
@keyframes sweep { 0% { transform: translateY(-120%); opacity: .9; } 100% { transform: translateY(380%); opacity: 0; } }

header.head { position: relative; flex: none; padding: 14px 14px 12px; border-bottom: 1px solid var(--line); overflow: hidden; }
header.head canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.brand { text-transform: uppercase; letter-spacing: .16em; font-size: 11px; display: flex; align-items: center; gap: 8px; }
.brand b { color: var(--accent); }
.icons { display: flex; gap: 2px; }
.ib { width: 28px; height: 28px; display: grid; place-items: center; color: var(--dim); transition: color .2s, background .2s; }
.ib:hover { color: var(--paper); background: var(--panel); }
.ib svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ib[data-spin="true"] svg { animation: spin .9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.score { position: relative; display: flex; align-items: flex-end; gap: 14px; margin-top: 14px; }
.score .n { font-size: 44px; line-height: .9; font-weight: 600; letter-spacing: -.04em; font-family: ui-sans-serif, system-ui, sans-serif; }
.score .l { color: var(--dim); text-transform: uppercase; font-size: 10px; letter-spacing: .14em; padding-bottom: 3px; }
.chips { position: relative; display: flex; gap: 1px; margin-top: 12px; background: var(--line); border: 1px solid var(--line); }
.chip { flex: 1; background: color-mix(in srgb, var(--ink) 88%, transparent); padding: 7px 9px; min-width: 0; }
.chip small { display: block; color: var(--dim); text-transform: uppercase; font-size: 9.5px; letter-spacing: .12em; }
.chip span { font-size: 14px; font-weight: 600; } .chip[data-t="good"] span { color: var(--ok); } .chip[data-t="warn"] span { color: var(--med); } .chip[data-t="bad"] span { color: var(--high); }

nav.tabs { position: relative; flex: none; display: flex; overflow-x: auto; border-bottom: 1px solid var(--line); scrollbar-width: none; }
nav.tabs::-webkit-scrollbar { display: none; }
.tab { flex: none; padding: 10px 12px; color: var(--dim); text-transform: uppercase; font-size: 10.5px; letter-spacing: .12em; display: flex; gap: 6px; align-items: center; transition: color .2s; }
.tab:hover { color: var(--paper); } .tab[aria-selected="true"] { color: var(--paper); }
.tab em { font-style: normal; font-size: 10px; padding: 0 5px; background: var(--panel); color: var(--dim); } .tab[data-sev="high"] em { background: var(--high); color: #1a0200; } .tab[data-sev="medium"] em { background: var(--med); color: #1a1200; }
.ind { position: absolute; bottom: 0; left: 0; height: 2px; width: var(--w, 0); background: var(--accent); transform: translateX(var(--x, 0)); transition: transform .3s cubic-bezier(.2,.7,.2,1), width .3s cubic-bezier(.2,.7,.2,1); }

.body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.empty { padding: 36px 20px; color: var(--dim); text-align: center; }
.empty b { display: block; color: var(--ok); font-size: 13px; margin-bottom: 4px; }

.item { border-bottom: 1px solid var(--line); border-left: 3px solid var(--sev, var(--line)); animation: in .35s both; animation-delay: calc(var(--i, 0) * 28ms); }
@keyframes in { from { opacity: 0; transform: translateX(10px); } }
.item[data-sev="high"] { --sev: var(--high); } .item[data-sev="medium"] { --sev: var(--med); } .item[data-sev="low"] { --sev: var(--low); }
.item > button.top { display: block; width: 100%; text-align: left; padding: 11px 12px; }
.dense .item > button.top { padding: 7px 12px; }
.item:hover { background: color-mix(in srgb, var(--panel) 70%, transparent); }
.short { color: var(--paper); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.item[data-open="true"] .short { -webkit-line-clamp: unset; }
.where { color: var(--dim); font-size: 11px; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail { display: none; padding: 2px 12px 14px; } .item[data-open="true"] .detail { display: block; animation: in .3s both; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: 8px 0; font-size: 11.5px; } .facts dt { color: var(--dim); } .facts dd { margin: 0; word-break: break-word; }
.fix { color: var(--paper); margin: 8px 0; }
pre.code { position: relative; margin: 6px 0; padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); overflow-x: auto; font: inherit; font-size: 11.5px; white-space: pre; }
pre.code[data-k="before"] { border-left: 2px solid var(--high); } pre.code[data-k="after"] { border-left: 2px solid var(--ok); }
.copy { position: absolute; top: 4px; right: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); background: var(--ink); padding: 2px 6px; border: 1px solid var(--line); }
.copy:hover { color: var(--paper); }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn { padding: 7px 10px; border: 1px solid var(--line); text-transform: uppercase; font-size: 10.5px; letter-spacing: .1em; transition: background .2s, color .2s, border-color .2s; }
.btn:hover { border-color: var(--accent); } .btn[data-solid="true"] { background: var(--accent); color: #1a0200; border-color: var(--accent); } .btn[disabled] { opacity: .5; cursor: progress; }
.thumb { display: flex; gap: 10px; align-items: center; margin: 8px 0; } .thumb img { width: 64px; height: 44px; object-fit: cover; background: var(--panel); border: 1px solid var(--line); }
.uses { margin: 6px 0 0; padding: 0; list-style: none; color: var(--dim); font-size: 11px; } .uses li { padding: 1px 0; }
.note { padding: 10px 12px; color: var(--dim); border-bottom: 1px solid var(--line); font-size: 11.5px; }

table.comp { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.comp th { text-align: right; font-weight: 400; color: var(--dim); text-transform: uppercase; font-size: 9.5px; letter-spacing: .1em; padding: 8px 10px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--ink); }
.comp th:first-child, .comp td:first-child { text-align: left; }
.comp td { padding: 7px 10px; text-align: right; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.comp tr:hover td { background: var(--panel); }
.comp .bar { display: block; height: 2px; background: var(--accent); margin-top: 4px; transform-origin: left; }
.comp td:first-child { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn { color: var(--med); }

.set { padding: 14px; display: grid; gap: 16px; }
.set label.f { display: grid; gap: 7px; } .set .t { color: var(--dim); text-transform: uppercase; font-size: 10px; letter-spacing: .13em; display: flex; justify-content: space-between; }
.set input[type=range] { width: 100%; accent-color: var(--accent); }
.sw { display: flex; gap: 6px; flex-wrap: wrap; } .sw button { width: 24px; height: 24px; border: 1px solid var(--line); background: var(--c); } .sw button[aria-pressed="true"] { outline: 2px solid var(--paper); outline-offset: 1px; }
.seg { display: flex; border: 1px solid var(--line); } .seg button { flex: 1; padding: 7px 4px; color: var(--dim); text-transform: uppercase; font-size: 10px; letter-spacing: .08em; } .seg button[aria-pressed="true"] { background: var(--accent); color: #1a0200; }
.tog { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 0; }
.tog button { width: 36px; height: 20px; border: 1px solid var(--line); position: relative; flex: none; } .tog button::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; background: var(--dim); transition: transform .2s, background .2s; }
.tog button[aria-pressed="true"] { border-color: var(--accent); } .tog button[aria-pressed="true"]::after { transform: translateX(16px); background: var(--accent); }
.foot { padding: 8px 12px; border-top: 1px solid var(--line); color: var(--dim); font-size: 10.5px; display: flex; justify-content: space-between; flex: none; }

.hl { position: fixed; z-index: 2147482999; pointer-events: none; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); box-shadow: 0 0 0 99999px rgba(0,0,0,.0); transition: all .12s; }
.hl i { position: absolute; left: -2px; top: -22px; background: var(--accent); color: #1a0200; padding: 1px 6px; font: 600 10.5px ui-monospace, monospace; font-style: normal; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }

@media (prefers-reduced-motion: reduce) {
  .panel, .ps[data-open="true"] .panel, .panel > *, .item, .ind { transition: none !important; animation: none !important; }
  .scan { display: none; }
}
@media (max-width: 520px) { .panel { width: calc(100vw - 16px); height: calc(100vh - 16px); } .ps[data-corner] { } }
`;
