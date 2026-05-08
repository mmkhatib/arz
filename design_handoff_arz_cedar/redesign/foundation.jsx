/* ─── Arz Cedar — design tokens, icons, primitives, mocks ───── */

/* ── Helpers ────────────────────────────────────────────────── */
window.relTime = (iso) => {
  const d = new Date(iso); const now = new Date();
  const m = Math.round((now - d)/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.round(m/60);
  if (h < 24) return h + 'h';
  const day = Math.round(h/24);
  if (day < 7) return day + 'd';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
};
window.fmtMs = (ms) => ms < 1000 ? ms+'ms' : (ms/1000).toFixed(1)+'s';
window.fmtTok = (n) => n>=1000 ? (n/1000).toFixed(1)+'k' : n;
window.shortModel = (m) => m.replace('claude-','').replace('anthropic/','').replace('-2025-','-').slice(0,18);

/* ── Topo line decoration (organic mountain contours) ────────── */
window.TopoLines = function TopoLines({ height=120, opacity=.5, color }) {
  const pathFor = (yOff, freq, amp) => {
    const pts = [];
    for (let x=0; x<=400; x+=10) {
      pts.push(`${x},${yOff + Math.sin((x*freq)/100)*amp + Math.cos((x*freq*1.7)/100)*amp*.5}`);
    }
    return 'M' + pts.join(' L');
  };
  const c = color || 'var(--cedar-line)';
  return (
    <svg viewBox={`0 0 400 ${height}`} preserveAspectRatio="none"
      style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity, pointerEvents:'none' }}>
      {[0,1,2,3,4].map(i => (
        <path key={i} d={pathFor(height*.2 + i*(height*.18), 1+i*.3, 6+i*2)}
          fill="none" stroke={c} strokeWidth=".8" opacity={.4 + i*.15}/>
      ))}
    </svg>
  );
};

/* ── Cedar mark (the brand) ─────────────────────────────────── */
window.CedarMark = function CedarMark({ size=24, style={} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={style}>
      <defs>
        <linearGradient id={`cm-${size}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(.78 .14 145)"/>
          <stop offset="100%" stopColor="oklch(.55 .15 150)"/>
        </linearGradient>
      </defs>
      {/* trunk */}
      <rect x="14.6" y="22" width="2.8" height="7" fill="oklch(.4 .04 50)" rx="1"/>
      {/* tiers */}
      <path d="M16 3 L23 12 L19 12 L26 21 L6 21 L13 12 L9 12 Z" fill={`url(#cm-${size})`}/>
      <path d="M16 7 L21 13 L17 13 L23 19 L9 19 L15 13 L11 13 Z" fill="oklch(.65 .12 145)" opacity=".7"/>
    </svg>
  );
};

window.UserMark = function UserMark({ size=24 }) {
  return (
    <div style={{
      width:size, height:size, borderRadius:'50%',
      background:'linear-gradient(135deg, oklch(.6 .08 50), oklch(.45 .06 30))',
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontSize:size*.42, fontWeight:600, fontFamily:'var(--fd)',
      flexShrink:0, border:'1px solid oklch(.55 .06 40)',
    }}>M</div>
  );
};

/* ── Icon set (expressive cedar/nature lean) ─────────────────── */
const iStroke = (path, w=14, sw=1.6) => (sz=w) => (
  <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

window.IC = {
  /* Today */
  overview: iStroke(<><path d="M8 2 L13 7 L13 13 L3 13 L3 7 Z"/><path d="M6.5 13v-3.5h3V13"/></>),
  chat: iStroke(<><path d="M3 4 h10 a1 1 0 0 1 1 1 v5 a1 1 0 0 1 -1 1 H6 l-3 3 V5 a1 1 0 0 1 1-1 z"/></>),

  /* Mind */
  memory: iStroke(<><circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="5"/><path d="M8 1.5v1.2M8 13.3v1.2M14.5 8h-1.2M2.7 8H1.5"/></>),
  capabilities: iStroke(<><path d="M2.5 8.5L6.5 12.5L13.5 5.5"/><path d="M3 4 L7 4"/></>),

  /* Work */
  schedule: iStroke(<><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.2 1.4"/></>),
  autopilot: iStroke(<><path d="M2 8 L14 8"/><path d="M8 2 L14 8 L8 14"/><circle cx="4" cy="8" r="1.2"/></>),
  autonomy: iStroke(<><path d="M3 12 C 3 7 5.5 4 8 4 C 10.5 4 13 7 13 12"/><circle cx="8" cy="11" r="1.4"/><path d="M8 4 V 2"/></>),
  board: iStroke(<><rect x="2.5" y="3" width="3.2" height="10" rx="1"/><rect x="6.4" y="3" width="3.2" height="6" rx="1"/><rect x="10.3" y="3" width="3.2" height="8" rx="1"/></>),
  agents: iStroke(<><circle cx="8" cy="3.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M8 5.3v2M8 7.3l-3.5 3M8 7.3l3.5 3"/></>),

  /* Reach */
  channels: iStroke(<><path d="M3 6 C 3 4 4.5 3 6 3 H10 C 11.5 3 13 4 13 6 V 9 C 13 10.5 11.5 12 10 12 H 7 L 4 14 V 12 H 6 Z"/></>),
  llm: iStroke(<><circle cx="8" cy="6" r="3.5"/><path d="M8 9.5 V 14"/><path d="M5 14 H 11"/><path d="M6.5 5.5 L 8 7 L 9.5 5.5"/></>),

  /* System */
  analytics: iStroke(<><path d="M2 13 L5 9 L8 11 L11 5 L14 8"/><circle cx="5" cy="9" r=".8" fill="currentColor"/><circle cx="11" cy="5" r=".8" fill="currentColor"/></>),
  settings: iStroke(<><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.9 3.1l-1.4 1.4M4.5 11.5L3.1 12.9M12.9 12.9l-1.4-1.4M4.5 4.5L3.1 3.1"/></>),

  /* Glyphs */
  search: iStroke(<><circle cx="7" cy="7" r="4"/><path d="M10.5 10.5l3 3"/></>),
  plus: iStroke(<><path d="M8 3v10M3 8h10"/></>),
  close: iStroke(<><path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5"/></>),
  chevL: iStroke(<><path d="M10 3 L 5 8 L 10 13"/></>),
  chevR: iStroke(<><path d="M6 3 L 11 8 L 6 13"/></>),
  chevD: iStroke(<><path d="M3 6 L 8 11 L 13 6"/></>),
  more: iStroke(<><circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/></>),
  send: iStroke(<><path d="M2.5 8 L 13.5 8"/><path d="M9 4 L 13.5 8 L 9 12"/></>),
  stop: iStroke(<><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></>),
  download: iStroke(<><path d="M8 2 V 10"/><path d="M5 7 L 8 10 L 11 7"/><path d="M3 13 H 13"/></>),
  copy: iStroke(<><rect x="3.5" y="5" width="7.5" height="8" rx="1"/><path d="M5.5 3 H 12 a 1 1 0 0 1 1 1 V 10.5"/></>),
  edit: iStroke(<><path d="M3 13 L 5 12.5 L 12.5 5 L 11 3.5 L 3.5 11 Z"/></>),
  trash: iStroke(<><path d="M3 5h10M5 5V3.5h6V5M5.5 5l.5 8h4l.5-8"/></>),
  pin: iStroke(<><path d="M8 1.5 V 8 M 5.5 8 H 10.5 L 8 13 Z" fill="currentColor"/></>, 14, 1.2),
  spark: iStroke(<><path d="M8 2 L 9 6 L 13 7 L 9 8 L 8 12 L 7 8 L 3 7 L 7 6 Z" fill="currentColor" stroke="none"/></>),
  clip: iStroke(<><path d="M11 5 L 6 10 a 2 2 0 0 0 2.8 2.8 L 14 7.5 a 3.5 3.5 0 0 0 -5 -5 L 4 7.5 a 5 5 0 0 0 7 7 L 14 11.5"/></>),
  wrench: iStroke(<><path d="M11 2 a 3 3 0 0 1 3 3 L 8 11 L 5 14 L 2 11 L 5 8 L 11 2 z"/></>),
  check: iStroke(<><path d="M3 8 L 7 12 L 13 4"/></>),
  pause: iStroke(<><rect x="4.5" y="3.5" width="2.5" height="9" rx=".5" fill="currentColor"/><rect x="9" y="3.5" width="2.5" height="9" rx=".5" fill="currentColor"/></>),
  play: iStroke(<><path d="M5 3 L 12 8 L 5 13 Z" fill="currentColor"/></>),
  filter: iStroke(<><path d="M2 4 L 14 4 L 10 9 V 13 L 6 13 V 9 Z"/></>),
  bot: iStroke(<><rect x="3" y="5" width="10" height="8" rx="2"/><circle cx="6" cy="9" r=".8" fill="currentColor"/><circle cx="10" cy="9" r=".8" fill="currentColor"/><path d="M8 5V3"/></>),
};

/* ── Primitives ──────────────────────────────────────────────── */

window.Card = function Card({ children, padding=16, style={}, hoverable=false, ...rest }) {
  return (
    <div {...rest} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding,
      transition: 'all .15s',
      ...style,
    }}
      onMouseEnter={hoverable ? e => { e.currentTarget.style.borderColor='var(--cedar-line)'; e.currentTarget.style.background='var(--surface-hi)'; rest.onMouseEnter && rest.onMouseEnter(e); } : rest.onMouseEnter}
      onMouseLeave={hoverable ? e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--surface)'; rest.onMouseLeave && rest.onMouseLeave(e); } : rest.onMouseLeave}>
      {children}
    </div>
  );
};

window.Btn = function Btn({ children, kind='outline', size='md', icon, onClick, style={}, disabled, ...rest }) {
  const sizes = {
    sm: { padding: icon&&!children ? '5px' : '5px 9px', fontSize:11.5, gap:5, h:24 },
    md: { padding: icon&&!children ? '7px' : '7px 12px', fontSize:12.5, gap:6, h:30 },
  };
  const kinds = {
    solid:   { bg:'var(--cedar)', bd:'var(--cedar)', fg:'#fff' },
    outline: { bg:'var(--bg)', bd:'var(--border)', fg:'var(--text)' },
    soft:    { bg:'var(--cedar-dim)', bd:'var(--cedar-line)', fg:'var(--cedar-glow)' },
    ghost:   { bg:'transparent', bd:'transparent', fg:'var(--text2)' },
    danger:  { bg:'var(--ember-dim)', bd:'var(--ember)', fg:'var(--ember)' },
  };
  const s = sizes[size]; const k = kinds[kind];
  return (
    <button onClick={onClick} disabled={disabled} {...rest} style={{
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap:s.gap,
      padding:s.padding, fontSize:s.fontSize, height:s.h,
      background:k.bg, border:`1px solid ${k.bd}`, color:k.fg,
      borderRadius:7, cursor: disabled?'default':'pointer',
      fontFamily:'var(--fn)', fontWeight:500, whiteSpace:'nowrap',
      opacity: disabled?.5:1, transition:'all .12s', ...style,
    }}
      onMouseEnter={e => { if(disabled) return; if(kind==='ghost') e.currentTarget.style.background='var(--s2)'; else if(kind==='outline') e.currentTarget.style.borderColor='var(--cedar-line)'; else if(kind==='solid') e.currentTarget.style.background='var(--cedar-2)'; }}
      onMouseLeave={e => { if(disabled) return; e.currentTarget.style.background=k.bg; e.currentTarget.style.borderColor=k.bd; }}>
      {icon}
      {children}
    </button>
  );
};

window.Tag = function Tag({ children, color='muted' }) {
  const map = {
    muted: { bg:'var(--s2)', bd:'var(--border)', fg:'var(--text3)' },
    cedar: { bg:'var(--cedar-dim)', bd:'var(--cedar-line)', fg:'var(--cedar-glow)' },
    pine:  { bg:'var(--pine-dim)', bd:'var(--pine)', fg:'var(--pine-2)' },
    stone: { bg:'var(--stone-dim)', bd:'var(--border2)', fg:'var(--stone)' },
    dawn:  { bg:'var(--dawn-dim)', bd:'var(--dawn)', fg:'var(--dawn)' },
    ember: { bg:'var(--ember-dim)', bd:'var(--ember)', fg:'var(--ember)' },
  };
  const k = map[color] || map.muted;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'1px 7px', fontSize:10, fontFamily:'var(--fm)',
      background:k.bg, border:`1px solid ${k.bd}`, color:k.fg,
      borderRadius:99, lineHeight:1.5, letterSpacing:'.02em', whiteSpace:'nowrap',
    }}>{children}</span>
  );
};

window.SegSeg = function SegSeg({ value, options, onChange, size='md' }) {
  const opts = options.map(o => typeof o === 'string' ? { value:o, label:o.charAt(0).toUpperCase()+o.slice(1) } : o);
  return (
    <div style={{ display:'inline-flex', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:7, padding:2 }}>
      {opts.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: size==='sm'?'4px 10px':'5px 12px',
          fontSize: size==='sm'?11:12,
          background: o.value===value?'var(--surface)':'transparent',
          border:'none', borderRadius:5, color: o.value===value?'var(--text)':'var(--text3)',
          cursor:'pointer', fontFamily:'var(--fn)', fontWeight: o.value===value?500:400,
          boxShadow: o.value===value?'0 1px 2px rgba(0,0,0,.3)':'none', transition:'all .12s',
        }}>{o.label}</button>
      ))}
    </div>
  );
};

window.PageHeader = function PageHeader({ eyebrow, title, sub, right }) {
  return (
    <header style={{
      padding:'28px 32px 22px',
      borderBottom:'1px solid var(--hairline)',
      position:'relative', zIndex:1,
    }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:24 }}>
        <div style={{ minWidth:0 }}>
          {eyebrow && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <span style={{ width:18, height:1, background:'var(--cedar-glow)' }}/>
              <span style={{ fontSize:10.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.18em', color:'var(--cedar-2)' }}>{eyebrow}</span>
            </div>
          )}
          <h1 style={{ fontFamily:'var(--fd)', fontSize:32, fontWeight:400, color:'var(--text)', lineHeight:1.1, margin:0, letterSpacing:'-.01em' }}>{title}</h1>
          {sub && <p style={{ marginTop:8, fontSize:13.5, color:'var(--text3)', lineHeight:1.6, maxWidth:680 }}>{sub}</p>}
        </div>
        {right && <div style={{ display:'flex', gap:8, flexShrink:0 }}>{right}</div>}
      </div>
    </header>
  );
};

/* ═══ Mock data ═══ */
const now = Date.now();
const ago = (m) => new Date(now - m*60000).toISOString();

window.MOCK = {
  SESSIONS: [
    { id:'s1', title:'Token refresh race condition in middleware', provider:'claude-code', msgs:42, updated_at:ago(8), pinned:true },
    { id:'s2', title:'Help me decide: pgvector vs Qdrant for RAG', provider:'claude-code', msgs:18, updated_at:ago(45) },
    { id:'s3', title:'Refactor auth flow to use OIDC', provider:'kiro-cli', msgs:67, updated_at:ago(120) },
    { id:'s4', title:'Cron syntax for "every weekday at 9am Beirut time"', provider:'claude-code', msgs:6, updated_at:ago(240) },
    { id:'s5', title:'Why is the deploy hanging on stage 3?', provider:'kiro-cli', msgs:24, updated_at:ago(720) },
  ],
  HISTORY: [
    { id:'h1', title:'SQL window function for running totals', msgs:12, updated_at:ago(60*24*3) },
    { id:'h2', title:'Set up Caddy reverse proxy on the home server', msgs:34, updated_at:ago(60*24*7) },
    { id:'h3', title:'Birthday plan for mom', msgs:8, updated_at:ago(60*24*12) },
  ],
  MSGS: [
    { id:1, role:'user', ts:ago(15), text:"The token-refresh middleware is racing on cold-start. Two concurrent requests both call /refresh, the second one gets a stale token, then we 401 in a loop." },
    { id:2, role:'asst', ts:ago(14), elapsed:2400, model:'claude-opus-4-7', usage:{in:1280,out:340}, tools:[{name:'Read',input:'middleware/auth.ts'},{name:'Grep',input:'refreshToken'}],
      text:"Classic refresh stampede. Three things stack up here:\n\n1. **Both requests pass the `if (expired)` check** before either has refreshed.\n2. The second request reads the *old* cached token after the first writes the new one — there's no read-after-write guarantee.\n3. On 401, your retry logic re-enters the same code path, so it loops.\n\nThe fix is a **singleton in-flight promise**:\n\n```ts\nlet inflight: Promise<string> | null = null;\nasync function refresh(): Promise<string> {\n  if (inflight) return inflight;\n  inflight = doRefresh().finally(() => { inflight = null; });\n  return inflight;\n}\n```\n\nAny concurrent caller `await`s the same promise. I can patch this in `auth.ts` and add a regression test — want me to do that?" },
    { id:3, role:'user', ts:ago(10), text:"Yes — patch it and add the test. Use vitest." },
    { id:4, role:'asst', ts:ago(9), elapsed:5800, model:'claude-opus-4-7', usage:{in:2160,out:780}, tools:[{name:'Edit',input:'middleware/auth.ts'},{name:'Write',input:'middleware/auth.test.ts'},{name:'Bash',input:'pnpm test'}],
      text:"Patched and tested. Summary:\n\n- **`middleware/auth.ts`** — added the singleton in-flight pattern, plus a hard ceiling of 1 retry on 401.\n- **`middleware/auth.test.ts`** — new test fires 5 concurrent expired requests and asserts only one network refresh happens.\n- All 47 tests pass in 1.2s.\n\nI also remembered this lesson — *prevent the next refresh stampede before it ships.*" },
  ],
  TOOL_ENTRIES: [
    { callId:'t1', name:'Read', input:'middleware/auth.ts', done:true },
    { callId:'t2', name:'Grep', input:'refreshToken', done:true },
    { callId:'t3', name:'Edit', input:'middleware/auth.ts', done:true },
    { callId:'t4', name:'Write', input:'middleware/auth.test.ts', done:true },
    { callId:'t5', name:'Bash', input:'pnpm test', done:true },
  ],

  WORKSPACE_FILES: [
    { path:'middleware/auth.ts',         status:'edited',   added:18, removed:6, ts:ago(2),  preview:'export class AuthMiddleware {' },
    { path:'middleware/auth.test.ts',    status:'created',  added:84, removed:0, ts:ago(3),  preview:'describe("token refresh", () => {' },
    { path:'middleware/auth.refresh.ts', status:'edited',   added:7,  removed:7, ts:ago(4),  preview:'const inflight = new Map();' },
    { path:'package.json',               status:'edited',   added:2,  removed:0, ts:ago(5),  preview:'"vitest": "^1.6.0"' },
    { path:'docs/auth-flow.md',          status:'created',  added:42, removed:0, ts:ago(7),  preview:'# Auth flow — singleton refresh' },
    { path:'middleware/legacy.ts',       status:'deleted',  added:0,  removed:124, ts:ago(8), preview:'// removed: replaced by auth.ts' },
    { path:'src/util/cache.ts',          status:'read',     added:0,  removed:0, ts:ago(9),  preview:'(reference only)' },
  ],

  SUBAGENTS: [
    { id:'sa1', name:'Singleton race investigator', role:'Reproduce + isolate the token refresh race', status:'complete', model:'opus-4.7', steps:6, tokens:'4.2k', spawned:ago(11), parent:'main' },
    { id:'sa2', name:'Test scaffold writer',         role:'Generate vitest cases for refresh stampede', status:'complete', model:'haiku-4.5', steps:3, tokens:'1.8k', spawned:ago(7),  parent:'main' },
    { id:'sa3', name:'Migration impact scout',       role:'Survey callers of auth.refresh() across repo', status:'running', progress:64, model:'haiku-4.5', steps:4, tokens:'2.1k', spawned:ago(2), parent:'main' },
    { id:'sa4', name:'Doc drafter',                  role:'Write the post-mortem-style markdown for /docs', status:'idle', model:'opus-4.7', steps:0, tokens:'0', spawned:ago(1), parent:'main' },
    { id:'sa5', name:'Caller patch reviewer',        role:'Cross-check 14 callers for the new singleton API', status:'failed', err:'lost context — exceeded budget', model:'haiku-4.5', steps:9, tokens:'8.4k', spawned:ago(14), parent:'sa3' },
  ],

  SSE_LOG: [
    { ts:ago(0.1),  level:'tool',   msg:'Bash → pnpm test', detail:'47 passed · 1.2s' },
    { ts:ago(0.3),  level:'asst',   msg:'message.delta', detail:'…and the refresh stampede is fixed.' },
    { ts:ago(0.6),  level:'memory', msg:'memory.write', detail:'lesson · "singleton in-flight pattern"' },
    { ts:ago(0.8),  level:'tool',   msg:'Edit → middleware/auth.ts', detail:'+18 / -6' },
    { ts:ago(1.0),  level:'tool',   msg:'Write → middleware/auth.test.ts', detail:'new file · 84 lines' },
    { ts:ago(1.5),  level:'asst',   msg:'tool_use.start', detail:'Bash · pnpm test' },
    { ts:ago(2.1),  level:'sub',    msg:'subagent.spawn', detail:'Singleton race investigator' },
    { ts:ago(2.4),  level:'tool',   msg:'Grep → "refreshToken"', detail:'14 matches in 6 files' },
    { ts:ago(2.7),  level:'tool',   msg:'Read → middleware/auth.ts', detail:'298 lines' },
    { ts:ago(3.0),  level:'user',   msg:'user.message', detail:'token refresh is racing under load — fix it' },
    { ts:ago(3.2),  level:'sys',    msg:'session.start', detail:'cli=claude-code · model=opus-4.7 · approval=trust' },
    { ts:ago(4.5),  level:'warn',   msg:'cost.budget', detail:'session at 38% of $5 daily cap' },
    { ts:ago(6.0),  level:'sub',    msg:'subagent.failed', detail:'Caller patch reviewer · lost context' },
  ],

  MEMORIES: [
    { id:'m1', kind:'lesson', title:'Prevent refresh stampedes with a singleton in-flight promise', body:'When multiple concurrent callers see an expired token they all race to refresh. Cache the in-flight Promise and return it for any caller during refresh.', tags:['auth','async','patterns'], strength:.95, created:ago(60*24*2) },
    { id:'m2', kind:'preference', title:'Use vitest, not jest', body:'You prefer vitest for new TypeScript projects — faster, native ESM, better watch mode.', tags:['tooling','testing'], strength:.92, created:ago(60*24*30) },
    { id:'m3', kind:'fact', title:'Beirut is UTC+3 / UTC+2 in winter', body:'Used for cron expressions and scheduling. DST rules: spring forward last Sunday of March.', tags:['timezone','schedule'], strength:.88, created:ago(60*24*8) },
    { id:'m4', kind:'lesson', title:'Always pin npm versions in package.json for libraries', body:"Saw two production breakages from caret-pinned versions in the last quarter. For libs you publish, exact pinning > caret.", tags:['npm','release'], strength:.86, created:ago(60*24*14) },
    { id:'m5', kind:'preference', title:'Tabs in code, 2-space yaml', body:"Tabs feel right in code; YAML is 2-space because indentation is meaningful and tabs are forbidden.", tags:['style','formatting'], strength:.78, created:ago(60*24*40) },
    { id:'m6', kind:'fact', title:'Database is PostgreSQL 16 on Neon', body:'Production runs Postgres 16.2 on Neon, branched per-PR. Pooler at port 6543.', tags:['db','infra'], strength:.82, created:ago(60*24*5) },
    { id:'m7', kind:'lesson', title:'Run migrations BEFORE deploy in zero-downtime stack', body:"With rolling deploys, schema must be backward-compatible with the old code. Migrate first, then ship.", tags:['db','deploy'], strength:.83, created:ago(60*24*9) },
    { id:'m8', kind:'preference', title:'Prefer named exports over default exports', body:"Default exports break IDE rename refactors silently and make grep harder. You prefer named.", tags:['style','typescript'], strength:.71, created:ago(60*24*22) },
    { id:'m9', kind:'fact', title:'Mahmoud uses macOS + iTerm2 + zsh + starship', body:'Default shell environment, for context when generating shell snippets.', tags:['env'], strength:.65, created:ago(60*24*45) },
    { id:'m10', kind:'lesson', title:'pgvector is fine up to ~5M rows; switch to Qdrant beyond', body:'Inferred from your "RAG vector store" conversation. Qdrant scales further but adds ops cost.', tags:['rag','db','scale'], strength:.62, created:ago(60*24*1) },
    { id:'m11', kind:'preference', title:'Cedar palette — warm green, not teal', body:'You said the dashboard should feel like Beirut in summer, not Pacific Northwest.', tags:['design'], strength:.58, created:ago(60*24*1) },
    { id:'m12', kind:'fact', title:'Side project domain is arz.so', body:'Registered Mar 2025, Cloudflare DNS, points at the home server.', tags:['domain'], strength:.55, created:ago(60*24*60) },
    { id:'m13', kind:'lesson', title:'When debugging deploys, read kubelet logs first', body:"Saved 40 min on the last hung-deploy by going straight to kubelet, not the app logs.", tags:['k8s','debug'], strength:.68, created:ago(60*24*4) },
    { id:'m14', kind:'preference', title:'Long replies should open with the answer', body:"You don't want to read three paragraphs of context before the conclusion. Lead with the result.", tags:['style','communication'], strength:.74, created:ago(60*24*11) },
  ],

  CRONS: [
    { id:'c1', name:'Morning brief',       expr:'0 7 * * *',     prompt:'Summarize overnight emails, calendar, and PR notifications. Email the result.', surface:'email',    state:'on',  next:'in 14h', last:'today 7:00', runs:48 },
    { id:'c2', name:'Standup notes',       expr:'30 9 * * 1-5',  prompt:'Pull yesterday\'s git activity, format as standup talking points. Post to Slack.', surface:'slack', state:'on',  next:'tomorrow 9:30', last:'today 9:30', runs:84 },
    { id:'c3', name:'Friday retro digest', expr:'0 17 * * 5',    prompt:'Read week\'s sessions, surface 3 lessons + 1 unresolved thread.', surface:'in-app', state:'on', next:'in 3d', last:'last Fri', runs:11 },
    { id:'c4', name:'Hourly inbox triage', expr:'@hourly',       prompt:'Glance at inbox; flag anything that needs me within 4h.', surface:'in-app', state:'on', next:'in 22m', last:'38m ago', runs:512 },
    { id:'c5', name:'Backup memory ledger',expr:'0 3 * * *',     prompt:'Snapshot ~/.arz/memory.db to encrypted off-site backup.', surface:'in-app', state:'off', next:'paused', last:'2d ago', runs:60 },
  ],

  USAGE_BY_DAY: [
    { d:'Sun', tokens:124000, msgs:32, cost:1.42 },
    { d:'Mon', tokens:218000, msgs:56, cost:2.61 },
    { d:'Tue', tokens:198000, msgs:48, cost:2.34 },
    { d:'Wed', tokens:152000, msgs:38, cost:1.78 },
    { d:'Thu', tokens:285000, msgs:71, cost:3.42 },
    { d:'Fri', tokens:142000, msgs:34, cost:1.65 },
    { d:'Sat',  tokens: 88000, msgs:21, cost: .98 },
  ],

  CAPS: [
    { id:'cap1', name:'File system', kind:'builtin', count:6, status:'on', desc:'Read, write, edit, glob, grep, list — direct access to the project workspace.', tools:['Read','Write','Edit','Glob','Grep','LS'] },
    { id:'cap2', name:'Shell', kind:'builtin', count:2, status:'on', desc:'Run shell commands. Deny patterns enforce safety boundaries.', tools:['Bash','RunCommand'] },
    { id:'cap3', name:'Web', kind:'builtin', count:2, status:'on', desc:'Search the web and fetch URLs. Results are summarized inline.', tools:['WebSearch','WebFetch'] },
    { id:'cap4', name:'GitHub', kind:'mcp', count:8, status:'on', desc:'Issues, PRs, repo browsing, code review. Authenticated as @mmkhatib.', tools:['list_issues','create_pr','review_pr','search_code','get_tree','read_file'] },
    { id:'cap5', name:'Postgres', kind:'mcp', count:5, status:'on', desc:'Read-only queries against the analytics replica. Schemas auto-introspected.', tools:['query','describe','explain','sample','schema'] },
    { id:'cap6', name:'Linear', kind:'mcp', count:6, status:'off', desc:'Pull tickets, update status, assign work. Off until you wire the OAuth.', tools:['list_issues','create','update','comment','transition'] },
    { id:'cap7', name:'Browser', kind:'builtin', count:1, status:'on', desc:'Headless Chromium for agent-driven page navigation and screenshots.', tools:['BrowserNavigate','BrowserSnapshot','BrowserClick'] },
  ],

  CHANNELS: [
    { id:'ch1', name:'#auth-refactor', purpose:'Token refresh stampede fix — patch + tests + docs', status:'active', members:['Coder','Reviewer','Test writer','Doc updater'], lastMsg:ago(2), msgCount:64,
      preview:[
        { from:'Coder', model:'opus', text:'@Reviewer patch is up — singleton in-flight promise + 1-retry ceiling. Mind taking a look?' },
        { from:'Reviewer', model:'gpt5', text:'@Coder LGTM on the pattern. One concern: what about cross-tab refresh? @Test writer can you add a multi-tab case?' },
        { from:'Test writer', model:'haiku', text:'On it — adding `BroadcastChannel` test now.' },
      ]},
    { id:'ch2', name:'#vector-db-decision', purpose:'pgvector vs Qdrant — bench + cost + recommendation', status:'active', members:['Researcher','Benchmarker','Cost analyst'], lastMsg:ago(38), msgCount:41,
      preview:[
        { from:'Benchmarker', model:'qwen', text:'Done at 1M / 5M / 20M rows. Qdrant wins on recall@10 by ~3pts; pgvector wins on insert throughput.' },
        { from:'Cost analyst', model:'gemini', text:'@Researcher managed Qdrant at our load is ~$340/mo. Self-hosted pgvector adds ~$0 (already on Postgres).' },
      ]},
    { id:'ch3', name:'#deploy-stage3', purpose:'Triage why deploys hang at stage 3', status:'paused', members:['SRE','Log reader'], lastMsg:ago(720), msgCount:18, preview:[] },
    { id:'ch4', name:'#friday-retro', purpose:'Weekly retro digest — owned by autopilot', status:'scheduled', members:['Summarizer'], lastMsg:ago(60*24*5), msgCount:0, preview:[] },
  ],
  CUSTOM_AGENTS: [
    { id:'ag1', name:'Coder', emoji:'🌲', color:'cedar', role:'Implementer',
      desc:'Writes code patches end-to-end. Reads the repo, plans, edits, runs tests.',
      tools:['Read','Write','Edit','Bash','Grep'], approval:'reads',
      systemPrompt:'You implement features. Always run the test suite after editing. Prefer minimal diffs.',
      uses:142, lastUsed:ago(8) },
    { id:'ag2', name:'Reviewer', emoji:'🔍', color:'stone', role:'Critic',
      desc:'Reads diffs and flags security issues, race conditions, missing tests, perf risks.',
      tools:['Read','Grep'], approval:'normal',
      systemPrompt:'You review code. Be specific and ruthless. Cite line numbers. Cover security, races, and tests.',
      uses:74, lastUsed:ago(15) },
    { id:'ag3', name:'Test writer', emoji:'🧪', color:'pine', role:'Tester',
      desc:'Generates table-driven tests covering happy path, edge cases, and regressions.',
      tools:['Read','Write','Bash'], approval:'reads',
      systemPrompt:'You write tests. Use the project\'s existing framework. Aim for coverage of branches, not lines.',
      uses:58, lastUsed:ago(9) },
    { id:'ag4', name:'Researcher', emoji:'📚', color:'dawn', role:'Investigator',
      desc:'Reads docs, runs comparisons, writes structured findings with citations.',
      tools:['WebFetch','Read'], approval:'normal',
      systemPrompt:'You research. Always cite sources. Output findings as a markdown table with tradeoffs.',
      uses:31, lastUsed:ago(120) },
    { id:'ag5', name:'Doc updater', emoji:'📝', color:'cedar', role:'Documentor',
      desc:'Keeps READMEs, CONTRIBUTING, and changelogs current with the latest changes.',
      tools:['Read','Edit'], approval:'reads',
      systemPrompt:'You update docs. Match the existing tone exactly. Never invent features.',
      uses:22, lastUsed:ago(60) },
    { id:'ag6', name:'SRE', emoji:'⛺', color:'ember', role:'Diagnoser',
      desc:'Reads logs and metrics, traces incidents, drafts post-mortems.',
      tools:['Read','Bash','Grep'], approval:'reads',
      systemPrompt:'You diagnose production issues. Form hypotheses, then verify with logs before acting.',
      uses:12, lastUsed:ago(720) },
  ],


  AUTOPILOT_RULES: [
    { id:'r1', name:'Auto-summarize long sessions', when:'session.msgs > 30', then:'Generate session summary, write to memory.', state:'on', triggered:18 },
    { id:'r2', name:'Triage urgent emails', when:'email contains "urgent" OR sender in vips', then:'Reply with ack, flag in board.', state:'on', triggered:7 },
    { id:'r3', name:'Quiet hours', when:'time in 22:00–07:00 Asia/Beirut', then:'Do not push to Slack/Telegram; queue for morning.', state:'on', triggered:124 },
    { id:'r4', name:'Auto-commit doc changes', when:'edit only touches .md files', then:'Commit with conventional message and push.', state:'off', triggered:3 },
    { id:'r5', name:'Recurring topic alert', when:'topic repeats 3× in 7 days', then:'Surface in Overview as pattern.', state:'on', triggered:2 },
  ],

  AUTONOMY_EVENTS: [
    { ts:ago(8), verdict:'auto', action:'Read', subject:'middleware/auth.ts', why:'Read-only file access, allow-listed.' },
    { ts:ago(7), verdict:'auto', action:'Edit', subject:'middleware/auth.ts', why:'Modifying file inside session workspace.' },
    { ts:ago(6), verdict:'auto', action:'Bash', subject:'pnpm test', why:'Matches safe-command pattern: pnpm test.' },
    { ts:ago(35), verdict:'asked', action:'Bash', subject:'pnpm publish', why:'Publish operation requires explicit approval.' },
    { ts:ago(120), verdict:'auto', action:'Memory.write', subject:'lesson: refresh stampede', why:'Memory writes auto-approved at trust level Trusted.' },
    { ts:ago(180), verdict:'asked', action:'Email.send', subject:'reply to investor@x.com', why:'Outbound email outside allow-list.' },
    { ts:ago(360), verdict:'auto', action:'WebFetch', subject:'github.com/anthropics/...', why:'Fetch from allow-listed domain.' },
    { ts:ago(720), verdict:'auto', action:'Cron.run', subject:'Standup notes', why:'Scheduled job, autopilot rule active.' },
  ],

  AGENTS: [
    { id:'a1', parent:'s1', name:'Test writer', role:'Generate vitest cases for the new singleton refresh pattern', status:'running', msgs:14 },
    { id:'a2', parent:'s1', name:'Doc updater', role:'Update CONTRIBUTING.md with the refresh pattern note', status:'complete', msgs:6 },
    { id:'a3', parent:'s2', name:'pgvector benchmark', role:'Run insert + ANN-recall benchmark at 1M, 5M, 20M rows', status:'complete', msgs:22 },
    { id:'a4', parent:'s2', name:'Qdrant cost model', role:'Estimate monthly cost on managed Qdrant for our load', status:'complete', msgs:10 },
    { id:'a5', parent:'s3', name:'OIDC discovery', role:'Inspect Auth0 OIDC discovery doc and list required claims', status:'failed', msgs:3 },
  ],

  BOARD: {
    'Now':       [
      { id:'t1', t:'Patch refresh stampede in auth middleware', src:'from chat · s1', age:'just now' },
      { id:'t2', t:'Decide pgvector vs Qdrant', src:'from chat · s2', age:'45m' },
    ],
    'Today':     [
      { id:'t3', t:'Friday retro digest review', src:'from cron', age:'2h' },
      { id:'t4', t:'Reply to investor email', src:'asked autopilot', age:'3h' },
      { id:'t5', t:'Fix flaky deploy on stage 3', src:'from chat · s5', age:'12h' },
    ],
    'This week': [
      { id:'t6', t:'Migrate analytics from Postgres 14 → 16', src:'self', age:'2d' },
      { id:'t7', t:'Wire Linear MCP', src:'from capabilities', age:'3d' },
      { id:'t8', t:'Document OIDC migration plan', src:'from chat · s3', age:'2d' },
    ],
    'Later':     [
      { id:'t9', t:'Move SMS channel from planned → live', src:'channels', age:'5d' },
      { id:'t10', t:'Audit memory: archive entries < 0.4 strength', src:'memory', age:'1w' },
    ],
  },

  AI_OPS: {
    'Waiting on you': [
      { id:'op1', who:'Coder · Claude Code', session:'s1', task:'Apply patch to auth middleware', why:'Trust gate — touches prod code', wait:'8m', model:'opus-4.7' },
      { id:'op2', who:'Reviewer · Codex',     session:'s3', task:'Approve OIDC migration plan',  why:'Ready for sign-off',          wait:'34m', model:'gpt-5' },
      { id:'op3', who:'SRE · Kiro',           session:'s5', task:'Restart stage-3 pod',           why:'Reads OK, action needs YOU',  wait:'1h',  model:'opus-4.7' },
    ],
    'Running': [
      { id:'op4', who:'Researcher · Gemini',  session:'s2', task:'Benchmarking pgvector vs Qdrant on 5M rows', progress:62, eta:'~4m left', model:'gemini-2.5' },
      { id:'op5', who:'Test writer · Haiku',  session:'s4', task:'Generating vitest cases for billing module', progress:28, eta:'~12m left', model:'haiku-4.5' },
      { id:'op6', who:'Coder · Claude Code',  session:'s7', task:'Refactoring webhook handler',                progress:81, eta:'~1m left',  model:'opus-4.7' },
    ],
    'Idle': [
      { id:'op7', who:'Reviewer · Claude Code', session:'s2', task:'Done — awaiting next prompt',  since:'12m', model:'opus-4.7' },
      { id:'op8', who:'Coder · Kiro',           session:'s3', task:'Done — awaiting next prompt',  since:'48m', model:'opus-4.7' },
      { id:'op9', who:'Researcher · GPT-5',     session:'s4', task:'Paused — context handoff',     since:'2h',  model:'gpt-5' },
    ],
    'Failed': [
      { id:'op10', who:'SRE · Kiro', session:'s5', task:'OIDC discovery probe', err:'auth0 returned 401 — token expired', when:'21m ago', model:'opus-4.7' },
    ],
  },

  TODOS: [
    { id:'td1', t:'Decide on pgvector vs Qdrant by Friday',        src:'from chat · s2', due:'in 2d',  done:false, priority:'high' },
    { id:'td2', t:'Email Layla the OIDC migration outline',         src:'from chat · s3', due:'today', done:false, priority:'med'  },
    { id:'td3', t:'Renew anthropic.com API key (rotates Nov 14)',  src:'from memory',     due:'in 6d', done:false, priority:'med'  },
    { id:'td4', t:'Buy more storage for off-site backups',          src:'from cron · c5',  due:'this week', done:false, priority:'low' },
    { id:'td5', t:'Reply to investor (Tarek)',                      src:'autopilot flag',  due:'today', done:true,  priority:'high' },
    { id:'td6', t:'Approve channel: SMS → live',                    src:'channels',        due:'in 3d', done:false, priority:'low' },
  ],

  CLIS: [
    { id:'cli1', name:'Claude Code', vendor:'Anthropic', version:'1.4.2', desc:'Agentic terminal coder by Anthropic. Default provider for sessions.', tags:['agent','tools','MCP'], installed:true, running:true, default:true },
    { id:'cli2', name:'Kiro CLI', vendor:'AWS', version:'0.9.1', desc:'Spec-driven coding agent from AWS, with structured PRD/design phases.', tags:['agent','spec'], installed:true, running:false },
    { id:'cli3', name:'Codex CLI', vendor:'OpenAI', version:'0.6.0', desc:'OpenAI\'s terminal coder built around GPT-5. Lightweight tool loop.', tags:['agent','code'], installed:false, running:false },
    { id:'cli4', name:'Gemini CLI', vendor:'Google', version:'0.3.4', desc:'Google\'s open agent CLI on Gemini 2.5. Long context, strong on multimodal.', tags:['agent','multimodal'], installed:false, running:false },
  ],
  CLOUD_MODELS: [
    { id:'cm1', name:'claude-opus-4.7', vendor:'Anthropic', context:'200k', cost:'$15/$75 per M', desc:'Top-tier reasoning + agentic. Default for complex sessions.', tags:['frontier','reasoning'], configured:true, primary:true },
    { id:'cm2', name:'claude-haiku-4.5', vendor:'Anthropic', context:'200k', cost:'$1/$5 per M', desc:'Fast and cheap. Used for autopilot rules and lightweight queries.', tags:['fast','cheap'], configured:true },
    { id:'cm3', name:'gpt-5', vendor:'OpenAI', context:'400k', cost:'$10/$30 per M', desc:'OpenAI flagship. Strong at long-doc analysis and structured output.', tags:['frontier'], configured:true },
    { id:'cm4', name:'gemini-2.5-pro', vendor:'Google', context:'2M', cost:'$5/$15 per M', desc:'Massive context window. Good for cross-repo analysis.', tags:['long-context'], configured:false },
    { id:'cm5', name:'grok-4', vendor:'xAI', context:'256k', cost:'$8/$24 per M', desc:'Real-time web access. Useful for news-aware tasks.', tags:['realtime'], configured:false },
  ],
  LOCAL_MODELS: [
    { id:'l1', name:'qwen2.5-coder:32b', size:'19.2 GB', ram:'24 GB', desc:'Strong local coder. Reaches GPT-4 class on common languages.', tags:['code','32B'], installed:true, running:true },
    { id:'l2', name:'llama3.3:70b', size:'40 GB', ram:'48 GB', desc:'General-purpose Meta model. Solid reasoning, broad knowledge.', tags:['general','70B'], installed:true, running:false },
    { id:'l3', name:'mistral-small:24b', size:'14 GB', ram:'18 GB', desc:'Fast tool-use model. Good for low-latency agent loops.', tags:['agentic','24B'], installed:true, running:false },
    { id:'l4', name:'phi-4:14b', size:'8.2 GB', ram:'12 GB', desc:'Microsoft reasoning-focused small model.', tags:['reasoning','14B'], installed:false, running:false },
    { id:'l5', name:'deepseek-r1:32b', size:'19 GB', ram:'24 GB', desc:'Reasoning trace shows its work.', tags:['reasoning','32B'], installed:false, running:false },
    { id:'l6', name:'nomic-embed-text', size:'274 MB', ram:'1 GB', desc:'Embedding model used by your local RAG memory store.', tags:['embedding','tiny'], installed:true, running:true },
  ],
};
