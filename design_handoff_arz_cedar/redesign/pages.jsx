/* ─── Arz Cedar — All Pages ─────────────────────────────────────
   Compact, hi-fi mocks for every page in the Arz dashboard.
   Memory / Schedule / Analytics each have 3 layout variants
   exposed via the Tweaks panel.
*/

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW — "the forest view"
   ═══════════════════════════════════════════════════════════════ */
function PageOverview({ go }) {
  const stats = [
    { lbl:'Active sessions', v:'6', sub:'+2 today', accent:'cedar' },
    { lbl:'Messages · 7d', v:'412', sub:'52% vs prev', accent:'cedar' },
    { lbl:'Tokens · 7d', v:'1.2M', sub:'$14.20 spent', accent:'stone' },
    { lbl:'Memories', v:'248', sub:'+18 this week', accent:'pine' },
  ];
  const recent = MOCK.SESSIONS.slice(0,4);
  const upcoming = MOCK.CRONS.filter(c=>c.state==='on').slice(0,3);
  return (
    <div data-screen-label="Overview" style={{ flex:1, overflowY:'auto', position:'relative' }}>
      <div style={{ position:'relative', overflow:'hidden' }}>
        <TopoLines height={140} opacity={.6}/>
        <PageHeader eyebrow="forest view"
          title={<span>Hello — your cedar is <em style={{ fontStyle:'italic', color:'var(--cedar-glow)' }}>thriving</em>.</span>}
          sub="Six conversations active, three jobs scheduled, eighteen new memories this week."
          right={<><Btn kind="soft" icon={IC.spark(13)}>What changed today?</Btn><Btn kind="solid" icon={IC.plus()} onClick={() => go('chat')}>New chat</Btn></>}/>
      </div>

      <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
        {stats.map(s => (
          <Card key={s.lbl} padding={18} style={{ position:'relative', overflow:'hidden' }}>
            <TopoLines height={60} opacity={.3}/>
            <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em' }}>{s.lbl}</div>
            <div style={{ fontFamily:'var(--fd)', fontSize:38, fontWeight:400, color:'var(--text)', lineHeight:1, marginTop:6 }}>{s.v}</div>
            <div style={{ fontSize:11, color:`var(--${s.accent})`, marginTop:6, fontFamily:'var(--fm)' }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ padding:'0 32px 32px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        {/* Recent sessions */}
        <Card padding={0}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>{IC.chat(15)}<span style={{ fontSize:13, fontWeight:500 }}>Active conversations</span></div>
            <Btn size="sm" kind="ghost" onClick={() => go('chat')}>Open chat →</Btn>
          </div>
          {recent.map(s => (
            <div key={s.id} onClick={() => go('chat')} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 18px',
              borderBottom:'1px solid var(--hairline)', cursor:'pointer',
            }} onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <span style={{ width:6, height:6, borderRadius:'50%', background: s.pinned?'var(--cedar-glow)':'var(--border2)', flexShrink:0 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12.5, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.title}</div>
                <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:2 }}>{s.msgs} msgs · {relTime(s.updated_at)}</div>
              </div>
              <Tag color={s.provider==='kiro-cli'?'stone':'cedar'}>{s.provider==='kiro-cli'?'Kiro':'CC'}</Tag>
            </div>
          ))}
        </Card>

        {/* Upcoming + autonomy */}
        <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
          <Card padding={0}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>{IC.schedule(15)}<span style={{ fontSize:13, fontWeight:500 }}>Up next</span></div>
              <Btn size="sm" kind="ghost" onClick={() => go('schedule')}>Schedule →</Btn>
            </div>
            {upcoming.map(c => (
              <div key={c.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--hairline)', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, color:'var(--text)' }}>{c.name}</div>
                  <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:2 }}>{c.expr} · next {c.next}</div>
                </div>
                <Tag color="dawn">{c.surface}</Tag>
              </div>
            ))}
          </Card>
          <Card padding={18} style={{ position:'relative', overflow:'hidden' }}>
            <TopoLines height={120} opacity={.4}/>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>{IC.autonomy(15)}<span style={{ fontSize:13, fontWeight:500 }}>Today's autonomy</span></div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
              Arzeh acted <strong style={{ color:'var(--text)' }}>32 times</strong> on your behalf — 28 auto-approved, 4 asked first.
            </div>
            <div style={{ display:'flex', gap:6, marginTop:12 }}>
              {Array.from({length:32}).map((_,i)=>(
                <div key={i} style={{
                  flex:1, height:18, borderRadius:2,
                  background: i<28 ? `oklch(${.55+(i%4)*.04} .12 150)` : 'var(--dawn)',
                  opacity: .55 + (i%3)*.15,
                }}/>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHAT — refined from the existing redesign
   ═══════════════════════════════════════════════════════════════ */
function inlineFmt(text) {
  const parts = []; const rx = /(\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*)/g;
  let last = 0, m, k = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[0].startsWith('**')) parts.push(<strong key={k++} style={{ fontWeight:600, color:'var(--text)' }}>{m[2]}</strong>);
    else if (m[0].startsWith('`')) parts.push(<code key={k++} style={{ fontFamily:'var(--fm)', fontSize:'.86em', background:'var(--s3)', border:'1px solid var(--border)', borderRadius:3, padding:'0.05em 0.35em', color:'var(--cedar-glow)' }}>{m[3]}</code>);
    else parts.push(<em key={k++}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
function CodeBlock({ lang, code }) {
  const [cp, setCp] = useState(false);
  return (
    <div style={{ margin:'8px 0', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--s2)', borderBottom:'1px solid var(--border)', padding:'5px 12px' }}>
        <span style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--muted)', letterSpacing:'.06em' }}>{lang||'code'}</span>
        <button onClick={() => { try{ navigator.clipboard.writeText(code); }catch(e){}; setCp(true); setTimeout(()=>setCp(false),1500); }}
          style={{ background:'none', border:'none', fontSize:10, color:cp?'var(--cedar-glow)':'var(--muted)', cursor:'pointer' }}>
          {cp?'✓ copied':'copy'}
        </button>
      </div>
      <pre style={{ background:'var(--bg)', padding:'12px 14px', overflowX:'auto', margin:0, fontFamily:'var(--fm)', fontSize:12, lineHeight:1.7, color:'var(--text)' }}><code>{code}</code></pre>
    </div>
  );
}
function MD({ text }) {
  const lines = text.split('\n'); const els = []; let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim(); const cl = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { cl.push(lines[i]); i++; }
      i++; els.push(<CodeBlock key={k++} lang={lang} code={cl.join('\n')}/>); continue;
    }
    if (l.startsWith('### ')) { els.push(<h3 key={k++} style={{ fontSize:'.95em', fontWeight:600, margin:'10px 0 4px', color:'var(--text)' }}>{inlineFmt(l.slice(4))}</h3>); i++; continue; }
    if (l.startsWith('## ')) { els.push(<h2 key={k++} style={{ fontSize:'1.05em', fontWeight:600, margin:'12px 0 4px', color:'var(--text)' }}>{inlineFmt(l.slice(3))}</h2>); i++; continue; }
    if (l.match(/^[*-] /)) { const it = []; while (i<lines.length && lines[i].match(/^[*-] /)) { it.push(<li key={i}>{inlineFmt(lines[i].slice(2))}</li>); i++; } els.push(<ul key={k++} style={{ listStyle:'disc', paddingLeft:'1.2em', margin:'4px 0' }}>{it}</ul>); continue; }
    if (l.match(/^\d+\. /)) { const it = []; while (i<lines.length && lines[i].match(/^\d+\. /)) { it.push(<li key={i}>{inlineFmt(lines[i].replace(/^\d+\. /,''))}</li>); i++; } els.push(<ol key={k++} style={{ listStyle:'decimal', paddingLeft:'1.2em', margin:'4px 0' }}>{it}</ol>); continue; }
    if (!l.trim()) { i++; continue; }
    const pl = []; while (i<lines.length && lines[i].trim() && !lines[i].startsWith('```') && !lines[i].match(/^#{1,3} /) && !lines[i].match(/^[*\-] /) && !lines[i].match(/^\d+\. /)) { pl.push(lines[i]); i++; }
    if (pl.length) els.push(<p key={k++} style={{ marginBottom:'.5em' }}>{inlineFmt(pl.join(' '))}</p>);
  }
  return <>{els}</>;
}

function MsgBubble({ msg, tweaks }) {
  const isU = msg.role === 'user';
  const [hov, setHov] = useState(false);
  const sp = tweaks.density==='compact'?8:tweaks.density==='airy'?18:13;
  return (
    <div className="fade-up" onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ display:'flex', justifyContent:isU?'flex-end':'flex-start', marginBottom:sp, gap:10, alignItems:'flex-start' }}>
      {!isU && <CedarMark size={26} style={{ marginTop:1 }}/>}
      <div style={{ display:'flex', flexDirection:'column', gap:3, maxWidth:isU?'72%':'calc(100% - 36px)', alignItems:isU?'flex-end':'flex-start' }}>
        <div style={{
          padding:isU?'8px 13px':'2px 0',
          borderRadius:isU?'14px 14px 4px 14px':5,
          background:isU?'var(--user-bg)':'transparent',
          border:isU?`1px solid var(--user-bd)`:'none',
          fontSize:14, lineHeight:1.7, color:'var(--text)', wordBreak:'break-word',
          whiteSpace:isU?'pre-wrap':undefined, fontFamily:'var(--fn)',
        }}>
          {isU ? msg.text : <MD text={msg.text}/>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, opacity:hov?1:.4, transition:'opacity .15s', fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>
          <span>{new Date(msg.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
          {!isU && msg.elapsed && <span>{fmtMs(msg.elapsed)}</span>}
          {!isU && msg.tools && <span style={{ color:'var(--cedar-2)' }}>{msg.tools.length} tool{msg.tools.length>1?'s':''}</span>}
          {!isU && msg.model && <span>{shortModel(msg.model)}</span>}
          {!isU && msg.usage && <span>{fmtTok(msg.usage.in)}↑ {fmtTok(msg.usage.out)}↓</span>}
        </div>
      </div>
      {isU && <UserMark size={26}/>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHAT — composer dropdowns
   ═══════════════════════════════════════════════════════════════ */
function ComposerSelect({ label, value, options, icon }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  const cur = options.find(o => o.value === v) || options[0];
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display:'inline-flex', alignItems:'center', gap:6, height:26, padding:'0 8px',
        background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6,
        color:'var(--text2)', fontSize:11.5, cursor:'pointer', fontFamily:'var(--fn)',
      }}>
        {icon && <span style={{ display:'flex', color:'var(--cedar-2)' }}>{icon}</span>}
        <span style={{ fontFamily:'var(--fm)', fontSize:9.5, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em' }}>{label}</span>
        <span style={{ color:'var(--text)', fontWeight:500 }}>{cur.label}</span>
        <span style={{ color:'var(--muted)', display:'flex' }}>{IC.chevD(9)}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:80 }}/>
          <div style={{ position:'absolute', bottom:'100%', left:0, marginBottom:4, minWidth:200, zIndex:90, background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8, boxShadow:'var(--shadow-2)', padding:4 }}>
            {options.map(o => (
              <button key={o.value} onClick={() => { setV(o.value); setOpen(false); }} style={{
                width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
                padding:'7px 10px', background: o.value===v?'var(--cedar-dim)':'transparent', border:'none',
                borderRadius:6, color:'var(--text)', fontSize:12.5, cursor:'pointer', textAlign:'left',
              }}
              onMouseEnter={e => { if (o.value !== v) e.currentTarget.style.background = 'var(--s2)'; }}
              onMouseLeave={e => { if (o.value !== v) e.currentTarget.style.background = 'transparent'; }}>
                <span>{o.label}</span>
                <span style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--fm)' }}>{o.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ApprovalPicker() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('reads');
  const levels = [
    { value:'normal', label:'Normal',  dot:'pine',  desc:'Ask before any tool runs.' },
    { value:'reads',  label:'Reads',   dot:'cedar', desc:'Auto-approve read-only tools. Ask for writes.' },
    { value:'trust',  label:'Trust',   dot:'dawn',  desc:'Auto-approve everything in workspace. Ask outside it.' },
    { value:'yolo',   label:'YOLO',    dot:'ember', desc:'Approve everything, including destructive ops.' },
  ];
  const cur = levels.find(l => l.value === v);
  const dotColor = { pine:'var(--pine)', cedar:'var(--cedar-glow)', dawn:'var(--dawn)', ember:'var(--ember)' }[cur.dot];
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display:'inline-flex', alignItems:'center', gap:6, height:26, padding:'0 8px',
        background: v==='yolo' ? 'oklch(.4 .14 30 / .25)' : 'var(--bg)',
        border:`1px solid ${v==='yolo'?'var(--ember)':'var(--border)'}`,
        borderRadius:6, color:'var(--text2)', fontSize:11.5, cursor:'pointer',
      }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background:dotColor, boxShadow:`0 0 4px ${dotColor}` }}/>
        <span style={{ fontFamily:'var(--fm)', fontSize:9.5, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em' }}>approval</span>
        <span style={{ color:'var(--text)', fontWeight:500 }}>{cur.label}</span>
        <span style={{ color:'var(--muted)', display:'flex' }}>{IC.chevD(9)}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:80 }}/>
          <div style={{ position:'absolute', bottom:'100%', left:0, marginBottom:4, minWidth:280, zIndex:90, background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, boxShadow:'var(--shadow-2)', padding:4 }}>
            <div style={{ padding:'8px 10px 6px', fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.12em' }}>Approval level</div>
            {levels.map(l => {
              const on = l.value === v;
              const c = { pine:'var(--pine)', cedar:'var(--cedar-glow)', dawn:'var(--dawn)', ember:'var(--ember)' }[l.dot];
              return (
                <button key={l.value} onClick={() => { setV(l.value); setOpen(false); }} style={{
                  width:'100%', display:'flex', alignItems:'flex-start', gap:10,
                  padding:'9px 10px', background:on?'var(--cedar-dim)':'transparent', border:'none',
                  borderRadius:7, color:'var(--text)', fontSize:12.5, cursor:'pointer', textAlign:'left',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--s2)'; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:c, marginTop:5, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:500 }}>{l.label}</div>
                    <div style={{ fontSize:11, color:'var(--text3)', marginTop:2, lineHeight:1.4 }}>{l.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PageChat({ tweaks }) {
  const [msgs, setMsgs] = useState(MOCK.MSGS);
  const [active, setActive] = useState('s1');
  const [streaming, setStreaming] = useState(false);
  const [val, setVal] = useState('');
  const [sessions, setSessions] = useState(MOCK.SESSIONS);
  const [history, setHistory] = useState(MOCK.HISTORY);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hoverRow, setHoverRow] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const togglePin = (id) => setSessions(p => p.map(s => s.id===id ? {...s, pinned:!s.pinned} : s));
  const archiveSession = (id) => {
    setSessions(p => p.filter(s => s.id !== id));
    const s = sessions.find(x => x.id === id); if (s) setHistory(h => [{ id:s.id, title:s.title, msgs:s.msgs, updated_at:s.updated_at }, ...h]);
    if (active === id) setActive(sessions[0]?.id);
  };
  const restoreFromHistory = (id) => {
    const h = history.find(x => x.id === id); if (!h) return;
    setHistory(p => p.filter(x => x.id !== id));
    setSessions(p => [{ id:h.id, title:h.title, provider:'claude-code', msgs:h.msgs, updated_at:new Date().toISOString() }, ...p]);
    setActive(h.id);
  };
  const startRename = (id, current) => { setRenamingId(id); setRenameDraft(current); };
  const commitRename = () => {
    if (!renamingId) return;
    setSessions(p => p.map(s => s.id===renamingId ? {...s, title:renameDraft || s.title} : s));
    setRenamingId(null);
  };
  const aiRename = (id) => {
    const s = sessions.find(x => x.id === id); if (!s) return;
    setRenameLoading(true);
    setTimeout(() => {
      const fresh = ['Auth refresh stampede — root cause + fix','Vector store: pgvector vs Qdrant decision','OIDC migration plan v2','Stage-3 deploy hang — kubelet trace','Webhook handler refactor (idempotency)'];
      const newTitle = fresh[Math.floor(Math.random()*fresh.length)];
      setSessions(p => p.map(x => x.id===id ? {...x, title:newTitle} : x));
      setRenameLoading(false);
    }, 700);
  };
  const sortedSessions = [...sessions].sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0));
  const btmRef = useRef(null);
  const taRef = useRef(null);
  useEffect(() => { btmRef.current && (btmRef.current.scrollTop = btmRef.current.scrollHeight); }, [msgs, streaming]);
  useEffect(() => { if(taRef.current){ taRef.current.style.height='auto'; taRef.current.style.height=Math.min(taRef.current.scrollHeight,160)+'px'; } }, [val]);
  const submit = () => {
    const m = val.trim(); if (!m) return; setVal('');
    setMsgs(p => [...p, { id:Date.now(), role:'user', ts:new Date().toISOString(), text:m }]);
    setStreaming(true);
    setTimeout(() => {
      setStreaming(false);
      setMsgs(p => [...p, { id:Date.now()+1, role:'asst', ts:new Date().toISOString(), elapsed:1800, model:'claude-opus-4-7', usage:{in:540,out:38}, text:"Looking into that — give me a moment." }]);
    }, 1400);
  };
  const session = sessions.find(s => s.id === active);
  return (
    <div data-screen-label="Chat" style={{ flex:1, display:'flex', minWidth:0, overflow:'hidden' }}>
      {/* sessions list */}
      <aside style={{ width:228, flexShrink:0, display:'flex', flexDirection:'column', background:'var(--surface)', borderRight:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px 10px 14px', borderBottom:'1px solid var(--border)', height:44 }}>
          <span style={{ fontSize:11.5, fontWeight:500, color:'var(--text2)', letterSpacing:'.04em', textTransform:'uppercase', fontFamily:'var(--fm)' }}>Conversations</span>
          <Btn size="sm" kind="ghost" icon={IC.plus(13)}/>
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {sortedSessions.map((s, idx) => {
            const isA = s.id === active;
            const isHover = hoverRow === s.id;
            const prev = sortedSessions[idx-1];
            const showPinDivider = prev && prev.pinned && !s.pinned;
            const isRenaming = renamingId === s.id;
            return (
              <React.Fragment key={s.id}>
                {showPinDivider && <div style={{ borderTop:'1px solid var(--hairline)', margin:'4px 12px' }}/>}
                <div onClick={() => !isRenaming && setActive(s.id)}
                  onMouseEnter={()=> setHoverRow(s.id)} onMouseLeave={()=> setHoverRow(null)}
                  style={{
                    position:'relative', display:'flex', alignItems:'flex-start', gap:8, padding:'9px 12px',
                    cursor: isRenaming ? 'text' : 'pointer',
                    background: isA?'var(--cedar-dim)':(isHover?'var(--s2)':'transparent'),
                    borderLeft:`2px solid ${isA?'var(--cedar-glow)':'transparent'}`,
                    transition:'background .1s',
                  }}>
                  {s.pinned && <span style={{ marginTop:6, display:'flex', color:'var(--cedar-glow)' }} title="Pinned">{IC.pin(9)}</span>}
                  <div style={{ flex:1, minWidth:0 }}>
                    {isRenaming ? (
                      <input autoFocus value={renameDraft}
                        onChange={e=>setRenameDraft(e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Enter') commitRename(); if(e.key==='Escape') setRenamingId(null); }}
                        onBlur={commitRename}
                        onClick={e=>e.stopPropagation()}
                        style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--cedar-glow)', borderRadius:4, padding:'3px 6px', fontSize:12.5, color:'var(--text)', fontFamily:'var(--fn)', outline:'none' }}/>
                    ) : (
                      <div style={{ fontSize:12.5, color:isA?'var(--text)':'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.4, fontWeight:isA?500:400 }}>{s.title}</div>
                    )}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                      <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)' }}>{relTime(s.updated_at)}</span>
                      <Tag color={s.provider==='kiro-cli'?'stone':'cedar'}>{s.provider==='kiro-cli'?'Kiro':'CC'}</Tag>
                      {renameLoading && active===s.id && <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--cedar-2)' }}>renaming…</span>}
                    </div>
                  </div>
                  {isHover && !isRenaming && (
                    <div style={{ position:'absolute', right:6, top:6, display:'flex', gap:2, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, padding:2, boxShadow:'0 2px 6px rgba(0,0,0,.2)' }}
                         onClick={e=>e.stopPropagation()}>
                      <button title={s.pinned?'Unpin':'Pin'} onClick={()=>togglePin(s.id)}
                        style={{ background:'transparent', border:'none', color: s.pinned?'var(--cedar-glow)':'var(--text3)', cursor:'pointer', padding:'3px 4px', display:'flex' }}>{IC.pin(11)}</button>
                      <button title="Rename" onClick={()=>startRename(s.id, s.title)}
                        style={{ background:'transparent', border:'none', color:'var(--text3)', cursor:'pointer', padding:'3px 4px', display:'flex' }}>{IC.edit(11)}</button>
                      <button title="Archive" onClick={()=>archiveSession(s.id)}
                        style={{ background:'transparent', border:'none', color:'var(--text3)', cursor:'pointer', padding:'3px 4px', display:'flex' }}>{IC.trash(11)}</button>
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        {/* History drawer pinned to bottom */}
        <div style={{ borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', maxHeight: historyOpen ? '50%' : 'auto', minHeight: 0 }}>
          <button onClick={()=>setHistoryOpen(o=>!o)}
            style={{ all:'unset', cursor:'pointer', display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderBottom: historyOpen ? '1px solid var(--hairline)' : 'none' }}>
            <span style={{ display:'flex', color:'var(--muted)', transform: historyOpen?'rotate(90deg)':'rotate(0)', transition:'transform .15s' }}>{IC.play(8)}</span>
            <span style={{ fontSize:10.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em', color:'var(--text2)', flex:1 }}>History</span>
            <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)' }}>{history.length}</span>
          </button>
          {historyOpen && (
            <div style={{ overflowY:'auto', flex:1, paddingBottom:6 }}>
              {history.map(h => (
                <div key={h.id} onClick={()=>restoreFromHistory(h.id)}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  style={{ padding:'7px 14px', cursor:'pointer', transition:'background .1s', display:'flex', alignItems:'flex-start', gap:8 }}
                  title="Restore to active">
                  <span style={{ marginTop:5, color:'var(--muted)', display:'flex' }}>{IC.spark(9)}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11.5, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.title}</div>
                    <div style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', marginTop:2 }}>{h.msgs} msgs · {relTime(h.updated_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* center column */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', padding:'0 18px', height:48, borderBottom:'1px solid var(--border)', gap:12 }}>
          <span style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)' }}>{session?.title||'New conversation'}</span>
          {session?.pinned && <span style={{ color:'var(--cedar-glow)', display:'flex' }} title="Pinned">{IC.pin(11)}</span>}
          <Tag color="cedar">{session?.provider==='kiro-cli'?'Kiro':'Claude Code'}</Tag>
          <span style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)' }}>{session?.msgs||0} messages · {relTime(session?.updated_at||new Date())}</span>
          <div style={{ flex:1 }}/>
          <Btn size="sm" kind="ghost" icon={IC.spark(13)} onClick={()=>active && aiRename(active)} disabled={renameLoading} title={renameLoading?'Renaming…':'Rename with AI'}/>
          <Btn size="sm" icon={IC.download(12)}>Export</Btn>
          <Btn size="sm" icon={IC.more(13)}/>
        </div>
        <div ref={btmRef} style={{ flex:1, overflowY:'auto', padding:'24px 26px 8px' }}>
          <div style={{ maxWidth:760, margin:'0 auto' }}>
            {msgs.map(m => <MsgBubble key={m.id} msg={m} tweaks={tweaks}/>)}
            {streaming && (
              <div className="fade-up" style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:13 }}>
                <CedarMark size={26} style={{ marginTop:1 }}/>
                <div style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'6px 0' }}>
                  {[0,1,2].map(i => <span key={i} style={{ width:5, height:5, borderRadius:'50%', background:'var(--cedar-glow)', animation:`bounce 1.2s ease-in-out ${i*.2}s infinite` }}/>)}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* input */}
        <div style={{ padding:'0 26px 18px' }}>
          <div style={{ maxWidth:760, margin:'0 auto', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:14, transition:'border-color .15s' }}>
            <textarea ref={taRef} value={val} onChange={e=>setVal(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Message Arzeh — your cedar listens patiently."
              rows={1}
              style={{ width:'100%', background:'transparent', border:'none', outline:'none', resize:'none', padding:'14px 18px 8px', fontSize:14, fontFamily:'var(--fn)', color:'var(--text)', lineHeight:1.6 }}/>
            <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px 10px', flexWrap:'wrap' }}>
              <ComposerSelect label="cli" value="cc" options={[
                {value:'cc',label:'Claude Code',sub:'Anthropic'},
                {value:'kiro',label:'Kiro CLI',sub:'AWS'},
                {value:'codex',label:'Codex CLI',sub:'OpenAI'},
                {value:'gem',label:'Gemini CLI',sub:'Google'},
              ]} icon={IC.wrench(11)}/>
              <ComposerSelect label="agent" value="coder" options={[
                {value:'coder',label:'Coder',sub:'🌲 implements'},
                {value:'reviewer',label:'Reviewer',sub:'🔍 critiques'},
                {value:'tester',label:'Test writer',sub:'🧪 tests'},
                {value:'researcher',label:'Researcher',sub:'📚 investigates'},
                {value:'sre',label:'SRE',sub:'⛺ diagnoses'},
              ]} icon={IC.bot(11)}/>
              <ComposerSelect label="model" value="opus" options={[
                {value:'opus',label:'Opus 4.7',sub:'frontier'},
                {value:'haiku',label:'Haiku 4.5',sub:'fast'},
                {value:'gpt5',label:'GPT-5',sub:'frontier'},
                {value:'gem25',label:'Gemini 2.5',sub:'long-context'},
                {value:'qwen',label:'Qwen 32B',sub:'local'},
              ]}/>
              <ApprovalPicker/>
              <div style={{ flex:1 }}/>
              <Btn size="sm" kind="ghost" icon={IC.clip()}/>
              {streaming
                ? <Btn size="sm" kind="danger" icon={IC.stop()} onClick={() => setStreaming(false)}/>
                : <button onClick={submit} disabled={!val.trim()} style={{
                    width:30, height:30, borderRadius:8, border:'none',
                    background: val.trim()?'var(--cedar)':'var(--s3)', color:val.trim()?'#fff':'var(--muted)',
                    display:'flex', alignItems:'center', justifyContent:'center', cursor:val.trim()?'pointer':'default',
                  }}>{IC.send(15)}</button>
              }
            </div>
          </div>
          <div style={{ textAlign:'center', fontSize:10.5, color:'var(--muted)', marginTop:8, fontFamily:'var(--fm)' }}>
            Arzeh · rooted in <span style={{ color:'var(--cedar-2)' }}>~/.arz</span> · responses persist locally
          </div>
        </div>
      </div>

      {/* activity rail */}
      <ActivityRail/>
    </div>
  );
}

/* ─── Activity rail ────────────────────────────────────────── */
function ActivityRail() {
  const [tab, setTab] = useState('Tools');
  const tabs = ['Tools','Files','Subagents','Log'];
  const counts = {
    Tools: MOCK.TOOL_ENTRIES.length,
    Files: MOCK.WORKSPACE_FILES.length,
    Subagents: MOCK.SUBAGENTS.length,
    Log: MOCK.SSE_LOG.length,
  };
  return (
    <aside style={{ width:300, flexShrink:0, borderLeft:'1px solid var(--border)', background:'var(--surface)', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', padding:'0 14px', height:44, borderBottom:'1px solid var(--border)', gap:8 }}>
        <span style={{ fontSize:12, fontWeight:500 }}>Activity</span>
        <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--cedar-glow)', animation:'pulse 1.6s infinite' }}/>
        <div style={{ flex:1 }}/>
        <Btn size="sm" kind="ghost" icon={IC.close(11)}/>
      </div>
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
        {tabs.map(t => {
          const on = tab === t;
          return (
            <div key={t} onClick={()=>setTab(t)} style={{
              flex:1, padding:'8px 0', textAlign:'center', fontSize:11.5,
              color:on?'var(--text)':'var(--text3)', fontWeight:on?500:400,
              borderBottom:`2px solid ${on?'var(--cedar-glow)':'transparent'}`, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              {t}
              <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:on?'var(--cedar-2)':'var(--muted)', background:on?'var(--cedar-dim)':'var(--s2)', padding:'1px 5px', borderRadius:3 }}>{counts[t]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ flex:1, overflowY:'auto' }}>
        {tab==='Tools'     && <ActivityTools/>}
        {tab==='Files'     && <ActivityFiles/>}
        {tab==='Subagents' && <ActivitySubagents/>}
        {tab==='Log'       && <ActivityLog/>}
      </div>
    </aside>
  );
}

function ActivityTools() {
  return (
    <div style={{ padding:8 }}>
      {MOCK.TOOL_ENTRIES.map(e => (
        <div key={e.callId} style={{ marginBottom:6, border:'1px solid var(--border)', borderRadius:8, background:'var(--bg)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px' }}>
            {IC.wrench(11)}
            <span style={{ fontSize:12, color:'var(--text)' }}>{e.name}</span>
            <span style={{ fontSize:10.5, color:'var(--cedar-2)', flex:1, fontFamily:'var(--fm)', overflow:'hidden', textOverflow:'ellipsis' }}>{e.input}</span>
            {e.done && <span style={{ color:'var(--cedar-glow)', fontSize:10.5, display:'flex', alignItems:'center', gap:3 }}>{IC.check(10)}</span>}
          </div>
        </div>
      ))}
      <div style={{ marginTop:14, padding:'10px 12px', borderRadius:8, background:'var(--cedar-dim)', border:'1px solid var(--cedar-line)', fontSize:11.5, color:'var(--text2)', lineHeight:1.6 }}>
        <strong style={{ color:'var(--cedar-glow)' }}>Roots growing:</strong> Arzeh wrote 1 lesson to memory this turn (token-refresh singleton pattern).
      </div>
    </div>
  );
}

function ActivityFiles() {
  const [sel, setSel] = useState(null);
  const stat = MOCK.WORKSPACE_FILES.reduce((a,f)=>{ a[f.status]=(a[f.status]||0)+1; return a; }, {});
  const statusColor = {
    edited:  { dot:'var(--cedar-glow)', bg:'var(--cedar-dim)', fg:'var(--cedar-2)' },
    created: { dot:'var(--pine)',        bg:'var(--pine-dim)',  fg:'var(--pine-2)'   },
    deleted: { dot:'var(--ember)',       bg:'var(--ember-dim)', fg:'var(--ember)'    },
    read:    { dot:'var(--text3)',       bg:'var(--s2)',        fg:'var(--text3)'    },
  };
  return (
    <div>
      <div style={{ display:'flex', gap:6, padding:'10px 10px 8px', flexWrap:'wrap', borderBottom:'1px solid var(--hairline)' }}>
        {Object.entries(stat).map(([k,v]) => (
          <span key={k} style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10.5, fontFamily:'var(--fm)', color:'var(--text3)' }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:statusColor[k]?.dot||'var(--text3)' }}/>
            {v} {k}
          </span>
        ))}
      </div>
      <div style={{ padding:6 }}>
        {MOCK.WORKSPACE_FILES.map(f => {
          const c = statusColor[f.status] || statusColor.read;
          const isOpen = sel === f.path;
          return (
            <div key={f.path} style={{ marginBottom:4, border:`1px solid ${isOpen?'var(--cedar-line)':'var(--border)'}`, borderRadius:6, background:'var(--bg)', overflow:'hidden', transition:'border-color .12s' }}>
              <div onClick={()=>setSel(isOpen?null:f.path)}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px', cursor:'pointer' }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:c.dot, flexShrink:0 }}/>
                <span style={{ fontSize:11.5, fontFamily:'var(--fm)', color:'var(--text)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.path}</span>
                {f.status !== 'read' && f.status !== 'deleted' && (
                  <span style={{ fontSize:10, fontFamily:'var(--fm)', display:'flex', gap:4 }}>
                    <span style={{ color:'var(--pine)' }}>+{f.added}</span>
                    <span style={{ color:'var(--ember)' }}>−{f.removed}</span>
                  </span>
                )}
                {f.status === 'deleted' && <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--ember)' }}>−{f.removed}</span>}
                <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{relTime(f.ts)}</span>
              </div>
              {isOpen && (
                <div style={{ borderTop:'1px solid var(--hairline)', background:'var(--s2)', padding:'8px 10px' }}>
                  <div style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.08em' }}>preview</div>
                  <div style={{ fontFamily:'var(--fm)', fontSize:11, color:'var(--text2)', whiteSpace:'pre', overflow:'hidden', textOverflow:'ellipsis' }}>{f.preview}</div>
                  <div style={{ display:'flex', gap:6, marginTop:9 }}>
                    <Btn size="sm" kind="outline" style={{ flex:1 }}>View diff</Btn>
                    <Btn size="sm" kind="ghost">Open</Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding:'8px 12px', borderTop:'1px solid var(--hairline)', display:'flex', gap:6 }}>
        <Btn size="sm" kind="soft" icon={IC.spark(11)} style={{ flex:1 }}>Review all</Btn>
        <Btn size="sm" kind="ghost" icon={IC.download(11)}>Export</Btn>
      </div>
    </div>
  );
}

function ActivitySubagents() {
  const [exp, setExp] = useState('sa3');
  const statusMeta = {
    running:  { dot:'var(--cedar-glow)', label:'running',  pulse:true  },
    complete: { dot:'var(--pine)',        label:'complete', pulse:false },
    idle:     { dot:'var(--text3)',       label:'idle',     pulse:false },
    failed:   { dot:'var(--ember)',       label:'failed',   pulse:false },
  };
  return (
    <div style={{ padding:8 }}>
      {MOCK.SUBAGENTS.map(sa => {
        const m = statusMeta[sa.status];
        const isOpen = exp === sa.id;
        return (
          <div key={sa.id} onClick={()=>setExp(isOpen?null:sa.id)}
            style={{ marginBottom:6, border:`1px solid ${isOpen?'var(--cedar-line)':'var(--border)'}`, borderRadius:8, background:'var(--bg)', cursor:'pointer', transition:'border-color .12s' }}>
            <div style={{ padding:'9px 10px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:m.dot, animation: m.pulse?'pulse 1.6s infinite':'none', flexShrink:0 }}/>
                <span style={{ fontSize:12, fontWeight:500, color:'var(--text)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sa.name}</span>
                <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em' }}>{m.label}</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.45, marginBottom:6 }}>{sa.role}</div>
              {sa.status==='running' && (
                <div style={{ height:2, background:'var(--s2)', borderRadius:1, overflow:'hidden' }}>
                  <div style={{ width:`${sa.progress}%`, height:'100%', background:'var(--cedar-glow)', boxShadow:'0 0 4px var(--cedar-glow)' }}/>
                </div>
              )}
              {sa.status==='failed' && (
                <div style={{ fontSize:10.5, color:'var(--ember)', fontFamily:'var(--fm)', marginTop:3 }}>err: {sa.err}</div>
              )}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:7, fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>
                <span>{sa.model}</span>
                <span>·</span>
                <span>{sa.steps} steps</span>
                <span>·</span>
                <span>{sa.tokens} tok</span>
                <div style={{ flex:1 }}/>
                <span>{relTime(sa.spawned)}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{ borderTop:'1px solid var(--hairline)', padding:'8px 10px', background:'var(--s2)', display:'flex', gap:6 }}>
                {sa.status==='running' && <><Btn size="sm" kind="outline" icon={IC.pause(10)} style={{ flex:1 }}>Pause</Btn><Btn size="sm" kind="ghost">Watch</Btn></>}
                {sa.status==='idle'    && <><Btn size="sm" kind="solid"   icon={IC.play(10)} style={{ flex:1 }}>Start</Btn><Btn size="sm" kind="ghost" icon={IC.trash(10)}/></>}
                {sa.status==='complete'&& <><Btn size="sm" kind="outline" style={{ flex:1 }}>View output</Btn><Btn size="sm" kind="ghost">Promote to memory</Btn></>}
                {sa.status==='failed'  && <><Btn size="sm" kind="solid"   icon={IC.play(10)} style={{ flex:1 }}>Retry</Btn><Btn size="sm" kind="ghost">Trace</Btn></>}
              </div>
            )}
          </div>
        );
      })}
      <Btn size="sm" kind="soft" icon={IC.plus(11)} style={{ width:'100%', marginTop:8 }}>Spawn subagent</Btn>
    </div>
  );
}

function ActivityLog() {
  const [filter, setFilter] = useState('all');
  const levelMeta = {
    sys:    { color:'var(--text3)',     glyph:'·' },
    user:   { color:'var(--stone)',     glyph:'›' },
    asst:   { color:'var(--cedar-glow)',glyph:'✦' },
    tool:   { color:'var(--cedar-2)',   glyph:'⚒' },
    sub:    { color:'var(--dawn)',      glyph:'⊚' },
    memory: { color:'var(--pine)',      glyph:'◉' },
    warn:   { color:'var(--ember)',     glyph:'!' },
  };
  const filters = ['all','tool','asst','sub','memory','warn'];
  const visible = MOCK.SSE_LOG.filter(e => filter==='all' || e.level===filter);
  return (
    <div>
      <div style={{ display:'flex', gap:4, padding:'8px 10px', borderBottom:'1px solid var(--hairline)', overflowX:'auto' }}>
        {filters.map(f => (
          <button key={f} onClick={()=>setFilter(f)}
            style={{ all:'unset', cursor:'pointer', padding:'3px 9px', fontSize:10.5, fontFamily:'var(--fm)', borderRadius:4,
              background: filter===f?'var(--cedar-dim)':'transparent',
              color: filter===f?'var(--cedar-glow)':'var(--text3)',
              border:`1px solid ${filter===f?'var(--cedar-line)':'transparent'}`, textTransform:'uppercase', letterSpacing:'.05em' }}>{f}</button>
        ))}
      </div>
      <div style={{ padding:'4px 0', fontFamily:'var(--fm)', fontSize:11 }}>
        {visible.map((e,i) => {
          const m = levelMeta[e.level] || levelMeta.sys;
          return (
            <div key={i} style={{ display:'flex', gap:8, padding:'4px 12px', borderLeft:`2px solid transparent`, alignItems:'baseline' }}
              onMouseEnter={ev=>ev.currentTarget.style.background='var(--s2)'}
              onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}>
              <span style={{ color:'var(--muted)', fontSize:9.5, width:46, flexShrink:0 }}>{relTime(e.ts)}</span>
              <span style={{ color:m.color, fontSize:10, width:10, flexShrink:0, textAlign:'center' }}>{m.glyph}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:'var(--text2)' }}>{e.msg}</div>
                {e.detail && <div style={{ color:'var(--muted)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding:'8px 10px', borderTop:'1px solid var(--hairline)', display:'flex', gap:6, alignItems:'center' }}>
        <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--cedar-glow)', animation:'pulse 1.6s infinite' }}/>
        <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', flex:1 }}>streaming · SSE</span>
        <Btn size="sm" kind="ghost" icon={IC.download(10)}>.jsonl</Btn>
      </div>
    </div>
  );
}

function _PageChat_unused() { return null; }

/* ═══════════════════════════════════════════════════════════════
   MEMORY — 3 variations
   ═══════════════════════════════════════════════════════════════ */
function PageMemory({ tweaks }) {
  const [variant, setVariant] = useState(tweaks.memoryVariant||'rings');
  useEffect(() => { setVariant(tweaks.memoryVariant); }, [tweaks.memoryVariant]);
  return (
    <div data-screen-label="Memory" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="rooted memory"
        title={<span><em style={{ fontStyle:'italic' }}>Rings</em> of what Arzeh remembers.</span>}
        sub="248 memories across lessons, facts, and preferences. Older rings are paler — durable lessons stay near the core."
        right={<>
          <SegSeg size="sm" value={variant} options={[{value:'rings',label:'Rings'},{value:'list',label:'List'},{value:'forest',label:'Forest'}]} onChange={setVariant}/>
          <Btn size="sm" kind="solid" icon={IC.plus()}>Remember…</Btn>
        </>}/>
      {variant === 'rings' && <MemoryRings/>}
      {variant === 'list' && <MemoryList/>}
      {variant === 'forest' && <MemoryForest/>}
    </div>
  );
}

function MemoryRings() {
  const [hov, setHov] = useState(null);
  const groups = [
    { r:0, label:'Core', items:MOCK.MEMORIES.filter(m=>m.strength>=.85) },
    { r:1, label:'Strong', items:MOCK.MEMORIES.filter(m=>m.strength>=.7 && m.strength<.85) },
    { r:2, label:'Recent', items:MOCK.MEMORIES.filter(m=>m.strength<.7) },
  ];
  return (
    <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'1fr 360px', gap:24 }}>
      {/* Rings viz */}
      <div style={{ position:'relative', aspectRatio:'1', maxWidth:520, margin:'0 auto', width:'100%' }}>
        <svg viewBox="0 0 400 400" style={{ width:'100%', height:'100%' }}>
          {[180,140,100].map((r,i)=>(
            <circle key={i} cx="200" cy="200" r={r}
              fill="none" stroke="var(--cedar-line)" strokeWidth={i===2?2:1}
              opacity={.3 + i*.2} strokeDasharray={i===0?'2 4':undefined}/>
          ))}
          <circle cx="200" cy="200" r="8" fill="var(--cedar-glow)"/>
          {groups.flatMap((g,gi) => g.items.map((m,mi) => {
            const total = g.items.length;
            const a = (mi/total)*Math.PI*2 - Math.PI/2 + (gi*.3);
            const r = [100,140,180][gi];
            const x = 200 + r*Math.cos(a), y = 200 + r*Math.sin(a);
            const isH = hov === m.id;
            const colors = { lesson:'var(--cedar-glow)', fact:'var(--stone)', preference:'var(--dawn)' };
            return (
              <g key={m.id}
                onMouseEnter={()=>setHov(m.id)} onMouseLeave={()=>setHov(null)}
                style={{ cursor:'pointer' }}>
                <circle cx={x} cy={y} r={isH?9:6}
                  fill={colors[m.kind]} opacity={.5+m.strength*.4}/>
                {isH && <circle cx={x} cy={y} r="14" fill="none" stroke={colors[m.kind]} strokeWidth="1" opacity=".5"/>}
              </g>
            );
          }))}
          {/* zone labels */}
          <text x="200" y="50" textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)', letterSpacing:'.1em' }}>RECENT</text>
          <text x="200" y="100" textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)', letterSpacing:'.1em' }}>STRONG</text>
          <text x="200" y="150" textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)', letterSpacing:'.1em' }}>CORE</text>
        </svg>
      </div>
      {/* Inspector */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <Card padding={16}>
          <div style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)', letterSpacing:'.1em', textTransform:'uppercase' }}>Inspector</div>
          {(() => {
            const m = hov ? MOCK.MEMORIES.find(x=>x.id===hov) : MOCK.MEMORIES[0];
            return (
              <>
                <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:8, marginBottom:6 }}>
                  <Tag color={m.kind==='lesson'?'cedar':m.kind==='fact'?'stone':'dawn'}>{m.kind}</Tag>
                  <span style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>{relTime(m.created)}</span>
                  <span style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>· strength {Math.round(m.strength*100)}%</span>
                </div>
                <div style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)', lineHeight:1.3, marginBottom:6 }}>{m.title}</div>
                <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.6 }}>{m.body}</div>
                <div style={{ display:'flex', gap:5, marginTop:12, flexWrap:'wrap' }}>
                  {m.tags.map(t => <Tag key={t} color="muted">#{t}</Tag>)}
                </div>
                <div style={{ display:'flex', gap:6, marginTop:14, paddingTop:12, borderTop:'1px solid var(--border)' }}>
                  <Btn size="sm" icon={IC.edit(12)}>Edit</Btn>
                  <Btn size="sm" kind="ghost" icon={IC.copy(11)}>Copy</Btn>
                  <Btn size="sm" kind="ghost" icon={IC.trash(12)}>Forget</Btn>
                </div>
              </>
            );
          })()}
        </Card>
        <Card padding={16}>
          <div style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)', letterSpacing:'.1em', textTransform:'uppercase', marginBottom:10 }}>Legend</div>
          {[{c:'cedar-glow',l:'Lesson — durable patterns'},{c:'stone',l:'Fact — checkable knowledge'},{c:'dawn',l:'Preference — your taste'}].map(x => (
            <div key={x.l} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', fontSize:12, color:'var(--text2)' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:`var(--${x.c})` }}/>{x.l}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function MemoryList() {
  const [filter, setFilter] = useState('all');
  const items = filter==='all' ? MOCK.MEMORIES : MOCK.MEMORIES.filter(m=>m.kind===filter);
  return (
    <div style={{ padding:'20px 32px' }}>
      <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
        <SegSeg size="sm" value={filter} options={['all','lesson','fact','preference']} onChange={setFilter}/>
        <div style={{ flex:1 }}/>
        <div style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 10px', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:7, width:280 }}>
          {IC.search(13)}<input placeholder="Search memories…" style={{ border:'none', background:'transparent', outline:'none', flex:1, color:'var(--text)', fontSize:12 }}/>
        </div>
      </div>
      <Card padding={0}>
        {items.map(m => (
          <div key={m.id} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:14, alignItems:'center', padding:'14px 18px', borderBottom:'1px solid var(--hairline)', cursor:'pointer' }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <Tag color={m.kind==='lesson'?'cedar':m.kind==='fact'?'stone':'dawn'}>{m.kind}</Tag>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:13.5, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.title}</div>
              <div style={{ fontSize:11.5, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>{m.body}</div>
            </div>
            <div style={{ display:'flex', gap:4 }}>{m.tags.slice(0,2).map(t => <Tag key={t} color="muted">#{t}</Tag>)}</div>
            {/* strength bar */}
            <div style={{ width:50, height:4, background:'var(--s3)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ width:`${m.strength*100}%`, height:'100%', background:'var(--cedar-glow)' }}/>
            </div>
            <span style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', minWidth:32, textAlign:'right' }}>{relTime(m.created)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function MemoryForest() {
  const tags = {};
  MOCK.MEMORIES.forEach(m => m.tags.forEach(t => { tags[t] = (tags[t]||[]); tags[t].push(m); }));
  return (
    <div style={{ padding:'20px 32px', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14 }}>
      {Object.entries(tags).map(([t, ms]) => (
        <Card key={t} padding={0} style={{ position:'relative', overflow:'hidden' }} hoverable>
          <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid var(--hairline)' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
              <span style={{ fontFamily:'var(--fd)', fontSize:20, color:'var(--text)' }}>#{t}</span>
              <span style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)' }}>{ms.length} memorie{ms.length>1?'s':''}</span>
            </div>
            {/* trees: one sapling per memory, height = strength */}
            <svg viewBox={`0 0 ${ms.length*16+8} 50`} style={{ width:'100%', marginTop:8, display:'block', height:50 }}>
              {ms.map((m,i) => (
                <g key={m.id}>
                  <line x1={i*16+8} y1="48" x2={i*16+8} y2={48-m.strength*32} stroke="var(--cedar)" strokeWidth="1.2"/>
                  <circle cx={i*16+8} cy={48-m.strength*32} r="3.5" fill={m.kind==='lesson'?'var(--cedar-glow)':m.kind==='fact'?'var(--stone)':'var(--dawn)'}/>
                </g>
              ))}
              <line x1="0" y1="48" x2="100%" y2="48" stroke="var(--border)"/>
            </svg>
          </div>
          {ms.slice(0,2).map(m => (
            <div key={m.id} style={{ padding:'8px 16px', fontSize:12, color:'var(--text2)', borderTop:'1px solid var(--hairline)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background:m.kind==='lesson'?'var(--cedar-glow)':m.kind==='fact'?'var(--stone)':'var(--dawn)', marginRight:8 }}/>
              {m.title}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE — 3 variations
   ═══════════════════════════════════════════════════════════════ */
function PageSchedule({ tweaks }) {
  const [v, setV] = useState(tweaks.scheduleVariant||'sun');
  useEffect(()=>setV(tweaks.scheduleVariant),[tweaks.scheduleVariant]);
  return (
    <div data-screen-label="Schedule" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="cycles"
        title={<span>The day's <em style={{ fontStyle:'italic' }}>tides</em>.</span>}
        sub="5 recurring jobs. The dial below shows a 24-hour orbit; jobs sit on the curve where they next fire."
        right={<>
          <SegSeg size="sm" value={v} options={[{value:'sun',label:'Dial'},{value:'tape',label:'Timeline'},{value:'list',label:'List'}]} onChange={setV}/>
          <Btn size="sm" kind="solid" icon={IC.plus()}>New job</Btn>
        </>}/>
      {v==='sun' && <ScheduleSun/>}
      {v==='tape' && <ScheduleTape/>}
      {v==='list' && <ScheduleList/>}
    </div>
  );
}

function ScheduleSun() {
  const now = new Date(); const hr = now.getHours() + now.getMinutes()/60;
  const angle = (h) => (h/24)*Math.PI*2 - Math.PI/2;
  const jobs = MOCK.CRONS.map((c,i) => ({ ...c, hour: (hr+1+i*4.5)%24 }));
  return (
    <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'1fr 320px', gap:24 }}>
      <div style={{ position:'relative', aspectRatio:'1', maxWidth:540, margin:'0 auto', width:'100%' }}>
        <svg viewBox="0 0 400 400" style={{ width:'100%', height:'100%' }}>
          {/* day arc */}
          <defs>
            <linearGradient id="dayg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--stone)" stopOpacity=".3"/>
              <stop offset="50%" stopColor="var(--dawn)" stopOpacity=".4"/>
              <stop offset="100%" stopColor="var(--stone)" stopOpacity=".3"/>
            </linearGradient>
          </defs>
          <circle cx="200" cy="200" r="160" fill="none" stroke="var(--border2)" strokeWidth="1" strokeDasharray="2 4"/>
          <circle cx="200" cy="200" r="160" fill="none" stroke="url(#dayg)" strokeWidth="22" strokeDasharray="503 503" strokeDashoffset="0" transform="rotate(-90 200 200)" opacity=".25"/>
          {/* hour ticks */}
          {Array.from({length:24}).map((_,i)=>{
            const a = angle(i); const x1 = 200 + 168*Math.cos(a), y1 = 200 + 168*Math.sin(a);
            const x2 = 200 + (i%6===0?180:174)*Math.cos(a), y2 = 200 + (i%6===0?180:174)*Math.sin(a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border2)" strokeWidth={i%6===0?1.5:.8}/>;
          })}
          {[0,6,12,18].map(i=>{
            const a = angle(i); const x = 200+200*Math.cos(a), y = 200+200*Math.sin(a);
            return <text key={i} x={x} y={y+4} textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)' }}>{['00','06','12','18'][i/6]}</text>;
          })}
          {/* now indicator */}
          {(() => { const a = angle(hr); return (
            <line x1="200" y1="200" x2={200+155*Math.cos(a)} y2={200+155*Math.sin(a)} stroke="var(--cedar-glow)" strokeWidth="1.5"/>
          ); })()}
          <circle cx="200" cy="200" r="4" fill="var(--cedar-glow)"/>
          {/* job pins */}
          {jobs.map((j,i)=>{
            const a = angle(j.hour); const x = 200+160*Math.cos(a), y = 200+160*Math.sin(a);
            return (
              <g key={j.id}>
                <line x1={200+140*Math.cos(a)} y1={200+140*Math.sin(a)} x2={x} y2={y} stroke="var(--cedar-line)" strokeWidth="1"/>
                <circle cx={x} cy={y} r="7" fill={j.state==='on'?'var(--cedar-glow)':'var(--muted)'} stroke="var(--surface)" strokeWidth="2"/>
                <text x={x+(Math.cos(a)>0?14:-14)} y={y+4} textAnchor={Math.cos(a)>0?'start':'end'} style={{ fontFamily:'var(--fn)', fontSize:11, fill:'var(--text)' }}>{j.name}</text>
              </g>
            );
          })}
          <text x="200" y="195" textAnchor="middle" style={{ fontFamily:'var(--fd)', fontSize:34, fill:'var(--text)' }}>{now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>
          <text x="200" y="215" textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)', letterSpacing:'.2em' }}>NOW</text>
        </svg>
      </div>
      {/* up next sidebar */}
      <Card padding={0}>
        <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)', fontSize:11, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--muted)', fontFamily:'var(--fm)' }}>Up next</div>
        {jobs.slice(0,4).map(j => (
          <div key={j.id} style={{ padding:'12px 16px', borderBottom:'1px solid var(--hairline)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:j.state==='on'?'var(--cedar-glow)':'var(--muted)' }}/>
              <span style={{ fontSize:13, color:'var(--text)' }}>{j.name}</span>
            </div>
            <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--fm)', marginTop:4 }}>{j.expr} · {j.surface}</div>
            <div style={{ fontSize:11, color:'var(--cedar-2)', fontFamily:'var(--fm)', marginTop:2 }}>fires in {j.next}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function ScheduleTape() {
  const HOURS = Array.from({length:24}).map((_,i)=>i);
  return (
    <div style={{ padding:'20px 32px' }}>
      <Card padding={0}>
        <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', borderBottom:'1px solid var(--border)', alignItems:'center' }}>
          <div style={{ padding:'10px 14px', fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em' }}>Job</div>
          <div style={{ display:'grid', gridTemplateColumns:`repeat(24,1fr)`, fontSize:9.5, color:'var(--muted)', fontFamily:'var(--fm)', padding:'6px 14px 6px 0' }}>
            {HOURS.map(h => <div key={h} style={{ textAlign:'center' }}>{h%6===0?String(h).padStart(2,'0'):''}</div>)}
          </div>
        </div>
        {MOCK.CRONS.map(c => (
          <div key={c.id} style={{ display:'grid', gridTemplateColumns:'160px 1fr', alignItems:'center', borderBottom:'1px solid var(--hairline)' }}>
            <div style={{ padding:'12px 14px' }}>
              <div style={{ fontSize:12.5, color:'var(--text)' }}>{c.name}</div>
              <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:2 }}>{c.expr}</div>
            </div>
            <div style={{ position:'relative', height:32, padding:'0 14px 0 0' }}>
              {/* Plot job hours randomly */}
              {c.expr === '@hourly' ? HOURS.map(h => (
                <div key={h} style={{ position:'absolute', top:8, left:`${(h/24)*100}%`, width:8, height:16, background:'var(--cedar-glow)', opacity:.7, borderRadius:2 }}/>
              )) : (
                [parseInt((c.expr.match(/^\d+ (\d+)/)||[,9])[1]||9,10)].map(h => (
                  <div key={h} style={{ position:'absolute', top:6, left:`${(h/24)*100}%`, width:14, height:20, background: c.state==='on'?'var(--cedar-glow)':'var(--muted)', borderRadius:3 }}/>
                ))
              )}
              {/* now line */}
              <div style={{ position:'absolute', top:0, bottom:0, left:`${((new Date().getHours()+new Date().getMinutes()/60)/24)*100}%`, width:1, background:'var(--ember)' }}/>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function ScheduleList() {
  return (
    <div style={{ padding:'20px 32px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
      {MOCK.CRONS.map(c => (
        <Card key={c.id} padding={18} hoverable>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:c.state==='on'?'var(--cedar-glow)':'var(--muted)' }}/>
            <span style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)' }}>{c.name}</span>
            <div style={{ flex:1 }}/>
            <Tag color="muted">{c.surface}</Tag>
          </div>
          <code style={{ display:'inline-block', fontSize:11, fontFamily:'var(--fm)', color:'var(--cedar-2)', background:'var(--bg)', padding:'3px 8px', borderRadius:5, border:'1px solid var(--border)', marginBottom:10 }}>{c.expr}</code>
          <div style={{ fontSize:12.5, color:'var(--text2)', lineHeight:1.55, marginBottom:12 }}>{c.prompt}</div>
          <div style={{ display:'flex', gap:14, fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)', borderTop:'1px solid var(--hairline)', paddingTop:10 }}>
            <span>↻ {c.runs} runs</span><span>last {c.last}</span><span>next {c.next}</span>
            <div style={{ flex:1 }}/>
            <Btn size="sm" kind="ghost" icon={c.state==='on'?IC.pause():IC.play()}/>
            <Btn size="sm" kind="ghost" icon={IC.edit(11)}/>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS — 3 variations
   ═══════════════════════════════════════════════════════════════ */
function PageAnalytics({ tweaks }) {
  const [v,setV] = useState(tweaks.analyticsVariant||'mountain');
  useEffect(()=>setV(tweaks.analyticsVariant),[tweaks.analyticsVariant]);
  const total = MOCK.USAGE_BY_DAY.reduce((s,d)=>s+d.tokens,0);
  const cost = MOCK.USAGE_BY_DAY.reduce((s,d)=>s+d.cost,0);
  return (
    <div data-screen-label="Analytics" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="terrain"
        title={<span>The week's <em style={{ fontStyle:'italic' }}>shape</em>.</span>}
        sub={`${(total/1e6).toFixed(2)}M tokens · $${cost.toFixed(2)} · 320 messages over 7 days.`}
        right={<>
          <SegSeg size="sm" value={v} options={[{value:'mountain',label:'Mountains'},{value:'grid',label:'Grid'},{value:'breakdown',label:'Breakdown'}]} onChange={setV}/>
          <Btn size="sm" icon={IC.download(12)}>CSV</Btn>
        </>}/>
      {v==='mountain' && <AnalyticsMountain total={total} cost={cost}/>}
      {v==='grid' && <AnalyticsGrid/>}
      {v==='breakdown' && <AnalyticsBreakdown/>}
    </div>
  );
}

function AnalyticsMountain({ total, cost }) {
  const W = 800, H = 240;
  const data = MOCK.USAGE_BY_DAY;
  const max = Math.max(...data.map(d=>d.tokens));
  const pts = data.map((d,i)=>({ x: (i/(data.length-1))*W, y: H - (d.tokens/max)*(H-30), d }));
  const path = pts.map((p,i)=>i===0?`M${p.x},${H} L${p.x},${p.y}`:`L${p.x},${p.y}`).join(' ') + ` L${W},${H}Z`;
  const line = pts.map((p,i)=>(i===0?'M':'L')+`${p.x},${p.y}`).join(' ');
  return (
    <div style={{ padding:'24px 32px', display:'flex', flexDirection:'column', gap:18 }}>
      <Card padding={0} style={{ overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em' }}>Tokens, last 7 days</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:14, marginTop:4 }}>
            <span style={{ fontFamily:'var(--fd)', fontSize:38, color:'var(--text)' }}>{(total/1e6).toFixed(2)}M</span>
            <span style={{ fontSize:13, color:'var(--cedar-2)' }}>+24% vs prev</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:H, display:'block' }}>
          <defs>
            <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cedar-glow)" stopOpacity=".4"/>
              <stop offset="100%" stopColor="var(--cedar-glow)" stopOpacity="0"/>
            </linearGradient>
          </defs>
          {[.25,.5,.75].map((p,i)=><line key={i} x1="0" x2={W} y1={H*p+15} y2={H*p+15} stroke="var(--border)" strokeDasharray="2 4"/>)}
          <path d={path} fill="url(#mtn)"/>
          <path d={line} fill="none" stroke="var(--cedar-glow)" strokeWidth="2"/>
          {pts.map((p,i)=>(
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill="var(--surface)" stroke="var(--cedar-glow)" strokeWidth="2"/>
              <text x={p.x} y={H-6} textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:10, fill:'var(--muted)' }}>{p.d.d}</text>
            </g>
          ))}
        </svg>
      </Card>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
        {[
          { lbl:'Spend', v:`$${cost.toFixed(2)}`, sub:'avg $2.04/day', a:'dawn' },
          { lbl:'Tool calls', v:'186', sub:'45 unique tools', a:'cedar' },
          { lbl:'Avg latency', v:'2.4s', sub:'p95 5.8s', a:'stone' },
        ].map(x => (
          <Card key={x.lbl} padding={16}>
            <div style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em' }}>{x.lbl}</div>
            <div style={{ fontFamily:'var(--fd)', fontSize:30, color:'var(--text)', marginTop:6, lineHeight:1 }}>{x.v}</div>
            <div style={{ fontSize:11, color:`var(--${x.a})`, marginTop:6, fontFamily:'var(--fm)' }}>{x.sub}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AnalyticsGrid() {
  /* heatmap days x hours */
  return (
    <div style={{ padding:'20px 32px' }}>
      <Card padding={20}>
        <div style={{ display:'flex', alignItems:'baseline', gap:14, marginBottom:18 }}>
          <span style={{ fontFamily:'var(--fd)', fontSize:22, color:'var(--text)' }}>Activity heatmap</span>
          <span style={{ fontSize:11.5, color:'var(--muted)' }}>last 12 weeks · darker = more messages</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8 }}>
          <div style={{ display:'flex', flexDirection:'column', justifyContent:'space-around', fontSize:9.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>
            {['Mon','Wed','Fri','Sun'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gridTemplateRows:'repeat(7, 14px)', gap:3 }}>
            {Array.from({length:84}).map((_,i)=>{
              const v = Math.random();
              return <div key={i} style={{ background: v<.2?'var(--s2)':v<.5?'oklch(.4 .1 150)':v<.8?'oklch(.55 .14 150)':'var(--cedar-glow)', borderRadius:2 }}/>;
            })}
          </div>
        </div>
      </Card>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:14 }}>
        <Card padding={20}>
          <div style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em' }}>Top tools</div>
          {[
            { n:'Read', v:84 }, { n:'Bash', v:62 }, { n:'Edit', v:48 }, { n:'Grep', v:31 }, { n:'Write', v:24 },
          ].map(t => (
            <div key={t.n} style={{ display:'grid', gridTemplateColumns:'80px 1fr 40px', alignItems:'center', gap:10, padding:'8px 0', fontSize:12 }}>
              <span style={{ fontFamily:'var(--fm)', color:'var(--text2)' }}>{t.n}</span>
              <div style={{ height:6, background:'var(--s3)', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${t.v}%`, background:'var(--cedar-glow)' }}/>
              </div>
              <span style={{ fontFamily:'var(--fm)', color:'var(--text3)', textAlign:'right' }}>{t.v}</span>
            </div>
          ))}
        </Card>
        <Card padding={20}>
          <div style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em' }}>Provider mix</div>
          <svg viewBox="0 0 100 50" style={{ width:'100%', height:120, marginTop:8 }}>
            <path d="M10 45 A 35 35 0 0 1 80 45" fill="none" stroke="var(--s3)" strokeWidth="10" strokeLinecap="round"/>
            <path d="M10 45 A 35 35 0 0 1 70 21" fill="none" stroke="var(--cedar-glow)" strokeWidth="10" strokeLinecap="round"/>
            <text x="45" y="30" textAnchor="middle" style={{ fontFamily:'var(--fd)', fontSize:14, fill:'var(--text)' }}>78%</text>
            <text x="45" y="42" textAnchor="middle" style={{ fontFamily:'var(--fm)', fontSize:5, fill:'var(--muted)' }}>CLAUDE CODE</text>
          </svg>
          <div style={{ display:'flex', justifyContent:'space-around', fontSize:11, fontFamily:'var(--fm)', marginTop:6 }}>
            <span style={{ color:'var(--cedar-glow)' }}>● CC 78%</span>
            <span style={{ color:'var(--stone)' }}>● Kiro 22%</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AnalyticsBreakdown() {
  return (
    <div style={{ padding:'20px 32px', display:'grid', gridTemplateColumns:'1fr', gap:14 }}>
      <Card padding={0}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--border)' }}>
              {['Day','Sessions','Messages','Tools','In tokens','Out tokens','Cost'].map(h => (
                <th key={h} style={{ padding:'12px 18px', textAlign:'left', fontSize:10.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.1em', color:'var(--muted)', fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK.USAGE_BY_DAY.map((d,i)=>(
              <tr key={i} style={{ borderBottom:'1px solid var(--hairline)' }}>
                <td style={{ padding:'12px 18px', fontFamily:'var(--fm)', color:'var(--text2)' }}>{d.d}</td>
                <td style={{ padding:'12px 18px', color:'var(--text)' }}>{Math.ceil(d.msgs/7)}</td>
                <td style={{ padding:'12px 18px', color:'var(--text)' }}>{d.msgs}</td>
                <td style={{ padding:'12px 18px', color:'var(--text)' }}>{Math.round(d.msgs*0.6)}</td>
                <td style={{ padding:'12px 18px', fontFamily:'var(--fm)', color:'var(--text2)' }}>{(d.tokens*.7/1000).toFixed(0)}k</td>
                <td style={{ padding:'12px 18px', fontFamily:'var(--fm)', color:'var(--text2)' }}>{(d.tokens*.3/1000).toFixed(0)}k</td>
                <td style={{ padding:'12px 18px', fontFamily:'var(--fm)', color:'var(--dawn)' }}>${d.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AGENTS — custom agents (LLM-agnostic personas)
   ═══════════════════════════════════════════════════════════════ */
function PageAgents() {
  const [sel, setSel] = useState('ag1');
  const a = MOCK.CUSTOM_AGENTS.find(x => x.id === sel) || MOCK.CUSTOM_AGENTS[0];
  const apprDot = { normal:'var(--pine)', reads:'var(--cedar-glow)', trust:'var(--dawn)', yolo:'var(--ember)' };
  return (
    <div data-screen-label="Agents" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="saplings"
        title={<span>Agents <em style={{ fontStyle:'italic' }}>you've shaped</em>.</span>}
        sub="Custom personas — system prompts, tool sets, approval policies. Any CLI or model can wear them."
        right={<Btn size="sm" kind="solid" icon={IC.plus()}>New agent</Btn>}/>
      <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'1fr 380px', gap:24 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14 }}>
          {MOCK.CUSTOM_AGENTS.map(x => {
            const on = x.id === sel;
            return (
              <Card key={x.id} padding={0} hoverable onClick={() => setSel(x.id)}
                style={{ cursor:'pointer', border: on?'1px solid var(--cedar-line)':undefined, background: on?'var(--cedar-dim)':undefined }}>
                <div style={{ padding:'14px 16px 10px', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:38, height:38, borderRadius:10, background:`var(--${x.color}-dim)`, border:`1px solid var(--${x.color === 'cedar' ? 'cedar-line' : 'border'})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{x.emoji}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)' }}>{x.name}</div>
                    <div style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', marginTop:2 }}>{x.role}</div>
                  </div>
                </div>
                <div style={{ padding:'0 16px 12px', fontSize:12.5, color:'var(--text2)', lineHeight:1.5 }}>{x.desc}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 16px', borderTop:'1px solid var(--hairline)', flexWrap:'wrap' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10.5, fontFamily:'var(--fm)', color:'var(--text3)' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:apprDot[x.approval] }}/>{x.approval}
                  </span>
                  <span style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>· {x.tools.length} tools</span>
                  <div style={{ flex:1 }}/>
                  <span style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>{x.uses} uses</span>
                </div>
              </Card>
            );
          })}
          {/* Empty new-agent slot */}
          <Card padding={0} hoverable style={{ cursor:'pointer', borderStyle:'dashed', minHeight:170, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, color:'var(--text3)' }}>
            <div style={{ width:38, height:38, borderRadius:10, border:'1px dashed var(--border2)', display:'flex', alignItems:'center', justifyContent:'center' }}>{IC.plus(15)}</div>
            <div style={{ fontSize:13 }}>Shape a new agent</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>system prompt + tools + approval</div>
          </Card>
        </div>
        {/* Inspector */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Card padding={18}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:44, height:44, borderRadius:11, background:`var(--${a.color}-dim)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>{a.emoji}</div>
              <div>
                <div style={{ fontFamily:'var(--fd)', fontSize:22, color:'var(--text)' }}>{a.name}</div>
                <div style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', marginTop:2 }}>{a.role} · {a.uses} runs · last {relTime(a.lastUsed)}</div>
              </div>
            </div>
            <div style={{ marginTop:14, fontSize:9.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.14em', color:'var(--muted)', marginBottom:6 }}>System prompt</div>
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', fontFamily:'var(--fm)', fontSize:11.5, color:'var(--text2)', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{a.systemPrompt}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:14 }}>
              <div>
                <div style={{ fontSize:9.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.14em', color:'var(--muted)', marginBottom:6 }}>Tools</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {a.tools.map(t => <Tag key={t} color="muted">{t}</Tag>)}
                </div>
              </div>
              <div>
                <div style={{ fontSize:9.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.14em', color:'var(--muted)', marginBottom:6 }}>Approval</div>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text)' }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:apprDot[a.approval] }}/>{a.approval}
                </span>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginTop:16, paddingTop:14, borderTop:'1px solid var(--hairline)' }}>
              <Btn size="sm" kind="solid" icon={IC.send(11)} style={{ flex:1 }}>Use in chat</Btn>
              <Btn size="sm" icon={IC.edit(11)}>Edit</Btn>
              <Btn size="sm" kind="ghost" icon={IC.copy(11)}/>
            </div>
          </Card>
          <Card padding={16}>
            <div style={{ fontSize:9.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.14em', color:'var(--muted)', marginBottom:8 }}>Compatible with</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12, color:'var(--text2)' }}>
              {[
                { label:'Claude Code', sub:'Anthropic CLI', dot:'cedar' },
                { label:'Kiro CLI',    sub:'AWS',           dot:'stone' },
                { label:'Codex CLI',   sub:'OpenAI',        dot:'dawn' },
                { label:'Gemini CLI',  sub:'Google',        dot:'pine' },
              ].map(x => (
                <div key={x.label} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:`var(--${x.dot}-glow, var(--${x.dot}))` }}/>
                  {x.label}
                  <span style={{ flex:1 }}/>
                  <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{x.sub}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:10, lineHeight:1.5 }}>The agent's persona stays the same — only the underlying model changes.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CAPABILITIES
   ═══════════════════════════════════════════════════════════════ */
function PageCapabilities() {
  return (
    <div data-screen-label="Capabilities" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="branches"
        title={<span>What Arzeh can <em style={{ fontStyle:'italic' }}>reach</em>.</span>}
        sub="Built-in tools and connected MCP servers. Toggle any to enable or disable for the next conversation."
        right={<Btn size="sm" kind="solid" icon={IC.plus()}>Connect MCP</Btn>}/>
      <div style={{ padding:'24px 32px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:14 }}>
          {MOCK.CAPS.map(c => (
            <Card key={c.id} padding={18} hoverable style={{ position:'relative', overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:8, background: c.kind==='builtin'?'var(--cedar-dim)':'var(--stone-dim)', display:'flex', alignItems:'center', justifyContent:'center', color: c.kind==='builtin'?'var(--cedar-glow)':'var(--stone)' }}>{IC.capabilities(18)}</div>
                  <div>
                    <div style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)' }}>{c.name}</div>
                    <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.08em' }}>{c.kind} · {c.count} tools</div>
                  </div>
                </div>
                <Toggle on={c.status==='on'}/>
              </div>
              <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:12, lineHeight:1.55 }}>{c.desc}</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:12, paddingTop:12, borderTop:'1px solid var(--hairline)' }}>
                {c.tools.slice(0,5).map(t => <Tag key={t} color="muted">{t}</Tag>)}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{
      width:34, height:18, borderRadius:9, border:'none', cursor:'pointer',
      background: on?'var(--cedar)':'var(--s3)',
      position:'relative', flexShrink:0, transition:'background .15s',
    }}>
      <span style={{
        position:'absolute', top:2, left: on?18:2, width:14, height:14,
        background:'#fff', borderRadius:'50%', transition:'left .15s',
        boxShadow:'0 1px 2px rgba(0,0,0,.4)',
      }}/>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHANNELS — agent collaboration rooms
   ═══════════════════════════════════════════════════════════════ */
function PageChannels() {
  const [sel, setSel] = useState('ch1');
  const c = MOCK.CHANNELS.find(x => x.id === sel) || MOCK.CHANNELS[0];
  const statusColor = { active:'cedar', paused:'muted', scheduled:'dawn' };
  const modelDot = { opus:'var(--cedar-glow)', haiku:'var(--cedar-2)', gpt5:'var(--stone)', gemini:'var(--pine)', qwen:'var(--dawn)' };
  return (
    <div data-screen-label="Channels" style={{ flex:1, display:'flex', minWidth:0, overflow:'hidden' }}>
      {/* Channel list */}
      <aside style={{ width:264, flexShrink:0, display:'flex', flexDirection:'column', background:'var(--surface)', borderRight:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', padding:'12px 14px', height:56, gap:10, borderBottom:'1px solid var(--border)' }}>
          <div>
            <div style={{ fontFamily:'var(--fd)', fontSize:16, color:'var(--text)' }}>Channels</div>
            <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>agent collab rooms</div>
          </div>
          <div style={{ flex:1 }}/>
          <Btn size="sm" kind="ghost" icon={IC.plus(13)}/>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:6 }}>
          {MOCK.CHANNELS.map(x => {
            const on = x.id === sel;
            return (
              <div key={x.id} onClick={() => setSel(x.id)} style={{
                padding:'10px 12px', cursor:'pointer', borderRadius:8, marginBottom:2,
                background: on ? 'var(--cedar-dim)' : 'transparent', borderLeft:`2px solid ${on?'var(--cedar-glow)':'transparent'}`,
              }}
                onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='var(--s2)'; }}
                onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent'; }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontFamily:'var(--fm)', fontSize:13, color:on?'var(--cedar-glow)':'var(--text)', fontWeight:on?500:400 }}>{x.name}</span>
                  <div style={{ flex:1 }}/>
                  {x.status==='active' && <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--cedar-glow)', boxShadow:'0 0 4px var(--cedar-glow)' }}/>}
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.purpose}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:5, fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)' }}>
                  <span>{x.members.length} agents</span>
                  <span>·</span>
                  <span>{x.msgCount} msgs</span>
                  <div style={{ flex:1 }}/>
                  <span>{relTime(x.lastMsg)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
      {/* Detail */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'0 22px', height:56, borderBottom:'1px solid var(--border)' }}>
          <span style={{ fontFamily:'var(--fd)', fontSize:22, color:'var(--text)' }}>{c.name}</span>
          <Tag color={statusColor[c.status]}>{c.status}</Tag>
          <span style={{ fontSize:12, color:'var(--text3)' }}>· {c.purpose}</span>
          <div style={{ flex:1 }}/>
          <div style={{ display:'flex', marginRight:6 }}>
            {c.members.map((m,i) => (
              <div key={m} title={m} style={{
                width:26, height:26, borderRadius:'50%', background:'var(--cedar-dim)', border:'2px solid var(--surface)',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:12,
                marginLeft: i>0?-8:0, zIndex:c.members.length-i,
              }}>{(MOCK.CUSTOM_AGENTS.find(a=>a.name===m)||{emoji:'🤖'}).emoji}</div>
            ))}
          </div>
          <Btn size="sm" icon={IC.plus(11)}>Invite</Btn>
          <Btn size="sm" kind="ghost" icon={IC.more(13)}/>
        </div>
        {/* Members rail */}
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 22px', borderBottom:'1px solid var(--hairline)', background:'var(--surface)', flexWrap:'wrap' }}>
          <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', marginRight:4 }}>Members</span>
          {c.members.map(m => {
            const ag = MOCK.CUSTOM_AGENTS.find(a => a.name === m) || { emoji:'🤖', role:'Agent' };
            return (
              <span key={m} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 9px 3px 6px', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:14, fontSize:11.5, color:'var(--text)' }}>
                <span style={{ fontSize:13 }}>{ag.emoji}</span>{m}
                <span style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--fm)' }}>· {ag.role}</span>
              </span>
            );
          })}
        </div>
        {/* Conversation */}
        <div style={{ flex:1, overflowY:'auto', padding:'18px 22px' }}>
          {c.preview.length === 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--muted)', textAlign:'center', gap:8 }}>
              <div style={{ fontSize:28, opacity:.5 }}>🌱</div>
              <div style={{ fontSize:14, color:'var(--text3)' }}>No activity yet</div>
              <div style={{ fontSize:12, color:'var(--muted)', maxWidth:380, lineHeight:1.5 }}>{c.status==='paused'?'This channel is paused. Resume to let the agents continue.':'Kick things off — @mention an agent or set a goal.'}</div>
            </div>
          )}
          {c.preview.map((m, i) => {
            const ag = MOCK.CUSTOM_AGENTS.find(a => a.name === m.from) || { emoji:'🤖', color:'cedar' };
            const parts = m.text.split(/(@\w[\w\s]*?)(?=[,.!?:]|$)/g);
            return (
              <div key={i} style={{ display:'flex', gap:12, marginBottom:18 }}>
                <div style={{ width:34, height:34, borderRadius:9, background:`var(--${ag.color}-dim)`, border:`1px solid var(--border)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, flexShrink:0 }}>{ag.emoji}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                    <span style={{ fontWeight:500, color:'var(--text)', fontSize:13.5 }}>{m.from}</span>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:modelDot[m.model]||'var(--muted)' }}/>{m.model}
                    </span>
                    <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>· just now</span>
                  </div>
                  <div style={{ marginTop:4, fontSize:13.5, color:'var(--text2)', lineHeight:1.6 }}>
                    {parts.map((p, j) => p.startsWith('@')
                      ? <span key={j} style={{ color:'var(--cedar-glow)', background:'var(--cedar-dim)', padding:'1px 5px', borderRadius:4, fontWeight:500 }}>{p}</span>
                      : <span key={j}>{p}</span>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Composer */}
        <div style={{ padding:'12px 22px 18px' }}>
          <div style={{ background:'var(--s2)', border:'1px solid var(--border)', borderRadius:12, padding:'10px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)' }}>
              <span style={{ color:'var(--cedar-2)' }}>You</span>
              <span>can @mention any agent — they'll pick up the task and reply.</span>
            </div>
            <input placeholder="Type a goal or @mention an agent…" style={{ width:'100%', background:'transparent', border:'none', outline:'none', fontSize:13.5, color:'var(--text)', padding:'8px 0 4px' }}/>
            <div style={{ display:'flex', alignItems:'center', gap:6, paddingTop:6, borderTop:'1px solid var(--hairline)' }}>
              <Btn size="sm" kind="ghost" icon={IC.bot(11)}>@mention</Btn>
              <Btn size="sm" kind="ghost" icon={IC.clip()}/>
              <div style={{ flex:1 }}/>
              <Btn size="sm" kind="solid" icon={IC.send(11)}>Send</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AUTOPILOT
   ═══════════════════════════════════════════════════════════════ */
function PageAutopilot() {
  return (
    <div data-screen-label="Autopilot" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="wing"
        title={<span>Rules that let Arzeh <em style={{ fontStyle:'italic' }}>fly</em> on its own.</span>}
        sub="When the rule matches, the action fires without bothering you."
        right={<Btn size="sm" kind="solid" icon={IC.plus()}>New rule</Btn>}/>
      <div style={{ padding:'24px 32px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {MOCK.AUTOPILOT_RULES.map(r => (
            <Card key={r.id} padding={0} hoverable>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr 1fr auto auto', alignItems:'center', gap:18, padding:'14px 18px' }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:r.state==='on'?'var(--cedar-glow)':'var(--muted)' }}/>
                <div>
                  <div style={{ fontSize:13.5, color:'var(--text)' }}>{r.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5 }}>
                    <Tag color="muted">when</Tag>
                    <code style={{ fontFamily:'var(--fm)', fontSize:11, color:'var(--text2)' }}>{r.when}</code>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Tag color="cedar">→ then</Tag>
                  <span style={{ fontSize:12, color:'var(--text2)' }}>{r.then}</span>
                </div>
                <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{r.triggered}× fired</span>
                <Toggle on={r.state==='on'}/>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AUTONOMY — recent decisions log
   ═══════════════════════════════════════════════════════════════ */
function PageAutonomy() {
  const auto = MOCK.AUTONOMY_EVENTS.filter(e=>e.verdict==='auto').length;
  const asked = MOCK.AUTONOMY_EVENTS.filter(e=>e.verdict==='asked').length;
  return (
    <div data-screen-label="Autonomy" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="trust"
        title={<span>What Arzeh did <em style={{ fontStyle:'italic' }}>without asking</em>.</span>}
        sub="Every autonomous action is logged. Nothing is hidden — adjust the trust dial below to bring more or fewer decisions back to you."/>
      <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'1fr 320px', gap:24 }}>
        <Card padding={0}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center' }}>
            <span style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em' }}>Recent decisions</span>
            <div style={{ flex:1 }}/>
            <Btn size="sm" kind="ghost" icon={IC.filter(11)}>Filter</Btn>
          </div>
          {MOCK.AUTONOMY_EVENTS.map((e,i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 1fr auto', alignItems:'center', gap:14, padding:'12px 18px', borderBottom:'1px solid var(--hairline)' }}>
              <Tag color={e.verdict==='auto'?'cedar':'dawn'}>
                {e.verdict==='auto'?'auto':'asked you'}
              </Tag>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:12.5, color:'var(--text)' }}>{e.action} · <span style={{ fontFamily:'var(--fm)', color:'var(--text2)' }}>{e.subject}</span></div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{e.why}</div>
              </div>
              <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{relTime(e.ts)}</span>
            </div>
          ))}
        </Card>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Card padding={18}>
            <div style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>Trust dial</div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              {['Ask everything','Ask risky','Trusted','Bold'].map((m,i)=>(
                <div key={m} style={{ flex:1, padding:'8px 4px', textAlign:'center', fontSize:10.5, background:i===2?'var(--cedar-dim)':'var(--s2)', border:`1px solid ${i===2?'var(--cedar-line)':'var(--border)'}`, borderRadius:6, color:i===2?'var(--cedar-glow)':'var(--text2)', fontFamily:'var(--fm)' }}>{m}</div>
              ))}
            </div>
            <div style={{ fontSize:11.5, color:'var(--text2)', lineHeight:1.55 }}>Currently <strong style={{ color:'var(--cedar-glow)' }}>Trusted</strong>: read-only tools auto, anything destructive asks first.</div>
          </Card>
          <Card padding={18}>
            <div style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em' }}>Today</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:8 }}>
              <div>
                <div style={{ fontFamily:'var(--fd)', fontSize:30, color:'var(--cedar-glow)' }}>{auto}</div>
                <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.08em' }}>auto</div>
              </div>
              <div>
                <div style={{ fontFamily:'var(--fd)', fontSize:30, color:'var(--dawn)' }}>{asked}</div>
                <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.08em' }}>asked</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOARD — kanban as cairn
   ═══════════════════════════════════════════════════════════════ */
function PageBoard() {
  const [todos, setTodos] = useState(MOCK.TODOS);
  const [filter, setFilter] = useState('all'); // all | open | done
  const toggleTodo = (id) => setTodos(p => p.map(t => t.id===id ? {...t, done:!t.done} : t));
  const visible = todos.filter(t => filter==='all' || (filter==='open' && !t.done) || (filter==='done' && t.done));
  const ops = MOCK.AI_OPS;
  const colMeta = {
    'Waiting on you': { dot:'var(--cedar-glow)',  hint:'needs your decision' },
    'Running':        { dot:'var(--pine)',         hint:'in flight'           },
    'Idle':           { dot:'var(--text3)',        hint:'parked, ready'        },
    'Failed':         { dot:'var(--dawn,#c97b5d)', hint:'check the trace'      },
  };
  const opCount = Object.values(ops).reduce((a,c)=>a+c.length, 0);
  const wait = ops['Waiting on you'].length;
  const run = ops['Running'].length;
  return (
    <div data-screen-label="Board" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="operations"
        title={<span>The <em style={{ fontStyle:'italic' }}>operations room</em>.</span>}
        sub={`${opCount} agents under your command — ${wait} waiting on you, ${run} running. Below: action items the cedar surfaced from your conversations.`}
        right={<><Btn size="sm" kind="ghost" icon={IC.spark(12)}>Refresh</Btn><Btn size="sm" kind="solid" icon={IC.plus()}>Dispatch agent</Btn></>}/>

      {/* AGENT OPS */}
      <div style={{ padding:'14px 32px 8px' }}>
        <div style={{ display:'flex', alignItems:'flex-end', gap:10, marginBottom:14 }}>
          <span style={{ width:14, height:1, background:'var(--cedar-glow)' }}/>
          <span style={{ fontSize:10, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.16em', color:'var(--cedar-2)' }}>Agent operations</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
          {Object.entries(ops).map(([col, items]) => {
            const meta = colMeta[col];
            return (
              <div key={col}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, padding:'0 4px' }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:meta.dot, boxShadow: col==='Running'? `0 0 8px ${meta.dot}` : 'none', animation: col==='Running'?'pulse 1.6s infinite':'none' }}/>
                  <span style={{ fontFamily:'var(--fd)', fontSize:16, color:'var(--text)' }}>{col}</span>
                  <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{items.length}</span>
                </div>
                <div style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', marginBottom:8, padding:'0 4px' }}>{meta.hint}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {items.map(it => <AgentOpCard key={it.id} it={it} col={col}/>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ACTION ITEMS / TODOs */}
      <div style={{ padding:'28px 32px 32px' }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:14, gap:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:14, height:1, background:'var(--cedar-glow)' }}/>
            <span style={{ fontSize:10, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.16em', color:'var(--cedar-2)' }}>Your action items</span>
          </div>
          <div style={{ display:'flex', gap:4, padding:3, background:'var(--s2)', borderRadius:8, border:'1px solid var(--border)' }}>
            {['all','open','done'].map(f => (
              <button key={f} onClick={()=>setFilter(f)}
                style={{ all:'unset', cursor:'pointer', padding:'4px 10px', borderRadius:5, fontSize:11, fontFamily:'var(--fm)',
                  background: filter===f?'var(--cedar-dim)':'transparent',
                  color: filter===f?'var(--text)':'var(--muted)',
                  border: filter===f?'1px solid var(--cedar-line)':'1px solid transparent' }}>{f}</button>
            ))}
            <span style={{ fontSize:10, fontFamily:'var(--fm)', color:'var(--muted)', padding:'4px 8px 4px 4px' }}>{visible.length}</span>
          </div>
        </div>
        <Card padding={0}>
          {visible.map((t, i) => <TodoRow key={t.id} t={t} onToggle={()=>toggleTodo(t.id)} last={i===visible.length-1}/>)}
          {visible.length===0 && (
            <div style={{ padding:'32px 18px', textAlign:'center', color:'var(--muted)', fontSize:12.5, fontFamily:'var(--fm)' }}>Nothing here. Cedar's quiet.</div>
          )}
          <div style={{ borderTop:'1px solid var(--hairline)', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ color:'var(--cedar-2)', display:'flex' }}>{IC.spark(12)}</span>
            <span style={{ fontSize:11.5, color:'var(--text3)' }}>Cedar drafts these from your conversations and memory. Edit, dismiss, or convert into chat.</span>
            <div style={{ flex:1 }}/>
            <Btn size="sm" kind="ghost" icon={IC.plus(11)}>Add manually</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AgentOpCard({ it, col }) {
  return (
    <Card padding={12} hoverable>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:6 }}>
        <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--cedar-2)' }}>{it.who}</span>
        <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{it.model}</span>
      </div>
      <div style={{ fontSize:12.5, color:'var(--text)', lineHeight:1.45 }}>{it.task}</div>
      {col==='Waiting on you' && (
        <>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:6, fontStyle:'italic' }}>{it.why}</div>
          <div style={{ display:'flex', gap:6, marginTop:10 }}>
            <Btn size="sm" kind="solid" icon={IC.check(11)} style={{ flex:1 }}>Approve</Btn>
            <Btn size="sm" kind="outline">Open</Btn>
          </div>
          <div style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)', marginTop:6 }}>waiting {it.wait} · session {it.session}</div>
        </>
      )}
      {col==='Running' && (
        <>
          <div style={{ marginTop:9, height:3, background:'var(--s2)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ width:`${it.progress}%`, height:'100%', background:'var(--cedar-glow)', boxShadow:'0 0 6px var(--cedar-glow)' }}/>
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:6 }}>
            <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{it.progress}% · {it.eta}</span>
            <Btn size="sm" kind="ghost" icon={IC.pause(10)}/>
          </div>
        </>
      )}
      {col==='Idle' && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
            <span style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>idle {it.since}</span>
            <div style={{ flex:1 }}/>
            <Btn size="sm" kind="outline">Resume</Btn>
          </div>
        </>
      )}
      {col==='Failed' && (
        <>
          <div style={{ marginTop:8, padding:'7px 9px', background:'var(--dawn-dim, rgba(201,123,93,.1))', borderLeft:'2px solid var(--dawn,#c97b5d)', borderRadius:3, fontSize:11, color:'var(--text2)', fontFamily:'var(--fm)' }}>{it.err}</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8 }}>
            <Btn size="sm" kind="outline" icon={IC.play(10)} style={{ flex:1 }}>Retry</Btn>
            <Btn size="sm" kind="ghost">Trace</Btn>
          </div>
          <div style={{ fontSize:9.5, fontFamily:'var(--fm)', color:'var(--muted)', marginTop:6 }}>{it.when}</div>
        </>
      )}
    </Card>
  );
}

function TodoRow({ t, onToggle, last }) {
  const prioColor = { high:'var(--cedar-glow)', med:'var(--cedar-2)', low:'var(--text3)' }[t.priority];
  return (
    <div onClick={onToggle}
      style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom: last?'none':'1px solid var(--hairline)', cursor:'pointer', transition:'background .1s' }}
      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{ width:16, height:16, borderRadius:4, border:`1.5px solid ${t.done?'var(--cedar-glow)':'var(--border2)'}`, background: t.done?'var(--cedar-glow)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--bg)' }}>
        {t.done && IC.check(10)}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color: t.done?'var(--muted)':'var(--text)', textDecoration: t.done?'line-through':'none' }}>{t.t}</div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:3 }}>
          <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{t.src}</span>
          <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--text3)' }}>· due {t.due}</span>
        </div>
      </div>
      <span style={{ fontSize:9.5, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.08em', color: prioColor, padding:'2px 7px', border:`1px solid ${prioColor}`, borderRadius:3, opacity: t.done?.4:1 }}>{t.priority}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LLM INSTALLER — Models
   ═══════════════════════════════════════════════════════════════ */
function ModelSectionHeader({ eyebrow, title, sub, count }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', margin:'28px 0 12px', gap:16 }}>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
          <span style={{ width:14, height:1, background:'var(--cedar-glow)' }}/>
          <span style={{ fontSize:10, fontFamily:'var(--fm)', textTransform:'uppercase', letterSpacing:'.16em', color:'var(--cedar-2)' }}>{eyebrow}</span>
        </div>
        <div style={{ fontFamily:'var(--fd)', fontSize:24, color:'var(--text)', lineHeight:1.1 }}>{title}</div>
        {sub && <div style={{ fontSize:12.5, color:'var(--text3)', marginTop:4 }}>{sub}</div>}
      </div>
      <span style={{ fontSize:10.5, fontFamily:'var(--fm)', color:'var(--muted)' }}>{count} item{count!==1?'s':''}</span>
    </div>
  );
}

function CliCard({ c }) {
  return (
    <Card padding={18} hoverable style={{ position:'relative' }}>
      {c.default && <span style={{ position:'absolute', top:10, right:10 }}><Tag color="cedar">default</Tag></span>}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:'var(--cedar-dim)', border:'1px solid var(--cedar-line)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--cedar-glow)' }}>{IC.wrench(16)}</div>
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:'var(--fd)', fontSize:18, color:'var(--text)' }}>{c.name}</div>
          <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:2 }}>{c.vendor} · v{c.version}</div>
        </div>
      </div>
      <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:12, lineHeight:1.55 }}>{c.desc}</div>
      <div style={{ display:'flex', gap:5, marginTop:10 }}>{c.tags.map(t => <Tag key={t} color="muted">{t}</Tag>)}</div>
      <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--hairline)', display:'flex', gap:6, alignItems:'center' }}>
        {c.installed
          ? (c.running
              ? <Tag color="cedar"><span style={{ width:5, height:5, borderRadius:'50%', background:'var(--cedar-glow)', animation:'pulse 1.6s infinite' }}/>running</Tag>
              : <Tag color="pine">installed</Tag>)
          : <Tag color="muted">not installed</Tag>}
        <div style={{ flex:1 }}/>
        {!c.installed && <Btn size="sm" kind="solid" icon={IC.download(11)}>Install</Btn>}
        {c.installed && !c.default && <Btn size="sm" kind="outline">Set default</Btn>}
        <Btn size="sm" kind="ghost" icon={IC.more()}/>
      </div>
    </Card>
  );
}

function CloudCard({ m }) {
  return (
    <Card padding={18} hoverable style={{ position:'relative' }}>
      {m.primary && <span style={{ position:'absolute', top:10, right:10 }}><Tag color="cedar">primary</Tag></span>}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:'var(--stone-dim)', border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--stone)' }}>{IC.llm(16)}</div>
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:'var(--fm)', fontSize:14, color:'var(--text)' }}>{m.name}</div>
          <div style={{ fontSize:10.5, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:2 }}>{m.vendor} · {m.context} ctx · {m.cost}</div>
        </div>
      </div>
      <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:12, lineHeight:1.55 }}>{m.desc}</div>
      <div style={{ display:'flex', gap:5, marginTop:10 }}>{m.tags.map(t => <Tag key={t} color="muted">{t}</Tag>)}</div>
      <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--hairline)', display:'flex', gap:6, alignItems:'center' }}>
        {m.configured ? <Tag color="pine">API key set</Tag> : <Tag color="dawn">needs API key</Tag>}
        <div style={{ flex:1 }}/>
        {!m.configured && <Btn size="sm" kind="solid">Add key</Btn>}
        {m.configured && !m.primary && <Btn size="sm" kind="outline">Set primary</Btn>}
        <Btn size="sm" kind="ghost" icon={IC.more()}/>
      </div>
    </Card>
  );
}

function LocalCard({ m }) {
  return (
    <Card padding={18} hoverable>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
        <div>
          <div style={{ fontFamily:'var(--fm)', fontSize:14, color:'var(--text)' }}>{m.name}</div>
          <div style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--fm)', marginTop:3 }}>{m.size} · {m.ram} RAM</div>
        </div>
        {m.installed ? (m.running ? <Tag color="cedar"><span style={{ width:5, height:5, borderRadius:'50%', background:'var(--cedar-glow)', animation:'pulse 1.6s infinite' }}/>running</Tag> : <Tag color="pine">installed</Tag>) : <Tag color="muted">not installed</Tag>}
      </div>
      <div style={{ fontSize:12, color:'var(--text2)', marginTop:12, lineHeight:1.55 }}>{m.desc}</div>
      <div style={{ display:'flex', gap:5, marginTop:12 }}>{m.tags.map(t => <Tag key={t} color="muted">{t}</Tag>)}</div>
      <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--hairline)', display:'flex', gap:6 }}>
        {!m.installed && <Btn size="sm" kind="solid" icon={IC.download(11)} style={{ flex:1 }}>Pull</Btn>}
        {m.installed && !m.running && <Btn size="sm" kind="outline" icon={IC.play()} style={{ flex:1 }}>Start</Btn>}
        {m.installed && m.running && <Btn size="sm" kind="soft" icon={IC.pause()} style={{ flex:1 }}>Stop</Btn>}
        {m.installed && <Btn size="sm" kind="ghost" icon={IC.trash()}/>}
        <Btn size="sm" kind="ghost" icon={IC.more()}/>
      </div>
    </Card>
  );
}

function PageLLM() {
  return (
    <div data-screen-label="Models" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="pinecones"
        title={<span>Models &amp; <em style={{ fontStyle:'italic' }}>agents</em>.</span>}
        sub="The CLIs that drive sessions, the cloud models they call, and the local seeds you've planted on this machine."
        right={<Btn size="sm" kind="solid" icon={IC.download(13)}>Pull custom</Btn>}/>
      <div style={{ padding:'8px 32px 32px' }}>
        <ModelSectionHeader eyebrow="agents" title="CLIs" sub="Coding agents installed on your machine — the engines that drive sessions." count={MOCK.CLIS.length}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:14 }}>
          {MOCK.CLIS.map(c => <CliCard key={c.id} c={c}/>)}
        </div>

        <ModelSectionHeader eyebrow="canopy" title="Cloud models" sub="Frontier models reached by API — pay-per-token, no install." count={MOCK.CLOUD_MODELS.length}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:14 }}>
          {MOCK.CLOUD_MODELS.map(m => <CloudCard key={m.id} m={m}/>)}
        </div>

        <ModelSectionHeader eyebrow="seeds" title="Local models" sub="Ollama-compatible. 4 installed · 38 GB used of 256 GB free." count={MOCK.LOCAL_MODELS.length}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:14 }}>
          {MOCK.LOCAL_MODELS.map(m => <LocalCard key={m.id} m={m}/>)}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════ */
function PageSettings() {
  const [section, setSection] = useState('general');
  const SECTIONS = [
    { id:'general', label:'General' },
    { id:'providers', label:'Providers' },
    { id:'memory', label:'Memory' },
    { id:'security', label:'Security' },
    { id:'appearance', label:'Appearance' },
    { id:'advanced', label:'Advanced' },
  ];
  return (
    <div data-screen-label="Settings" style={{ flex:1, overflowY:'auto' }}>
      <PageHeader eyebrow="bones"
        title={<span>Settings.</span>}
        sub="Preferences live at ~/.arz/config.yaml — every change here writes there."/>
      <div style={{ padding:'20px 32px', display:'grid', gridTemplateColumns:'200px 1fr', gap:24, maxWidth:1100 }}>
        <nav style={{ display:'flex', flexDirection:'column', gap:1 }}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} style={{
              padding:'8px 12px', textAlign:'left', border:'none',
              background: section===s.id?'var(--cedar-dim)':'transparent',
              color: section===s.id?'var(--cedar-glow)':'var(--text2)',
              fontSize:13, fontWeight: section===s.id?500:400,
              borderRadius:7, cursor:'pointer', fontFamily:'var(--fn)', transition:'all .12s',
            }}>{s.label}</button>
          ))}
        </nav>
        <div>
          {section === 'general' && (
            <Card padding={24}>
              <SettingRow label="Default provider" desc="Used when a session doesn't specify one.">
                <SegSeg value="cc" options={[{value:'cc',label:'Claude Code'},{value:'kiro',label:'Kiro CLI'},{value:'sdk',label:'Anthropic SDK'}]} onChange={()=>{}}/>
              </SettingRow>
              <SettingRow label="Owner identity" desc="Used as your name across surfaces.">
                <input defaultValue="Mahmoud" style={inp}/>
              </SettingRow>
              <SettingRow label="Working directory" desc="Where sessions create their workspace.">
                <input defaultValue="~/code/arz" style={inp}/>
              </SettingRow>
              <SettingRow label="Auto-title sessions" desc="Generate a session title from the first reply.">
                <Toggle on/>
              </SettingRow>
              <SettingRow label="YOLO mode" desc="Auto-approve all tool calls (use with care).">
                <Toggle/>
              </SettingRow>
            </Card>
          )}
          {section === 'security' && (
            <Card padding={24}>
              <SettingRow label="Token auth" desc="Require a bearer token for all API requests.">
                <Toggle on/>
              </SettingRow>
              <SettingRow label="Bind address" desc="0.0.0.0 requires token auth.">
                <SegSeg value="local" options={[{value:'local',label:'127.0.0.1'},{value:'all',label:'0.0.0.0'}]} onChange={()=>{}}/>
              </SettingRow>
              <SettingRow label="Allow shell exec" desc="Bash, run_command, execute_code tools.">
                <Toggle on/>
              </SettingRow>
              <SettingRow label="Deny patterns" desc="Regex; matching commands always require approval.">
                <textarea defaultValue={"^rm -rf /\n^sudo\nformat"} rows={3} style={{...inp, fontFamily:'var(--fm)', resize:'vertical'}}/>
              </SettingRow>
            </Card>
          )}
          {section !== 'general' && section !== 'security' && (
            <Card padding={32} style={{ textAlign:'center', color:'var(--muted)' }}>
              <div style={{ fontFamily:'var(--fd)', fontSize:24, color:'var(--text2)', marginBottom:8 }}>{SECTIONS.find(s=>s.id===section).label}</div>
              <div style={{ fontSize:13 }}>This section follows the same pattern — labeled rows with controls inline. Wired up in Claude Code as you build it out.</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
const inp = {
  background:'var(--bg)', border:'1px solid var(--border)', borderRadius:7,
  padding:'7px 10px', fontSize:13, color:'var(--text)', fontFamily:'var(--fn)',
  outline:'none', minWidth:240,
};
function SettingRow({ label, desc, children }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:24, padding:'14px 0', borderBottom:'1px solid var(--hairline)' }}>
      <div>
        <div style={{ fontSize:13, color:'var(--text)' }}>{label}</div>
        <div style={{ fontSize:11.5, color:'var(--muted)', marginTop:2 }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAGE ROUTER
   ═══════════════════════════════════════════════════════════════ */
function PageRouter({ page, tweaks, go }) {
  switch (page) {
    case 'overview':     return <PageOverview go={go}/>;
    case 'chat':         return <PageChat tweaks={tweaks}/>;
    case 'memory':       return <PageMemory tweaks={tweaks}/>;
    case 'capabilities': return <PageCapabilities/>;
    case 'schedule':     return <PageSchedule tweaks={tweaks}/>;
    case 'autopilot':    return <PageAutopilot/>;
    case 'autonomy':     return <PageAutonomy/>;
    case 'board':        return <PageBoard/>;
    case 'agents':       return <PageAgents/>;
    case 'channels':     return <PageChannels/>;
    case 'llm':          return <PageLLM/>;
    case 'analytics':    return <PageAnalytics tweaks={tweaks}/>;
    case 'settings':     return <PageSettings/>;
    default: return <PageOverview go={go}/>;
  }
}

Object.assign(window, { PageRouter });
