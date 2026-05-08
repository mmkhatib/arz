/* ─── Arz Cedar — App Shell ────────────────────────────────────── */
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* Information architecture: 5 zones, flat within each */
const NAV = [
  { zone:'Today', items:[
    { id:'overview',     label:'Overview',      icon:IC.overview },
    { id:'chat',         label:'Chat',          icon:IC.chat },
  ]},
  { zone:'Mind', items:[
    { id:'memory',       label:'Memory',        icon:IC.memory },
    { id:'capabilities', label:'Capabilities',  icon:IC.capabilities },
  ]},
  { zone:'Work', items:[
    { id:'schedule',     label:'Schedule',      icon:IC.schedule },
    { id:'autopilot',    label:'Autopilot',     icon:IC.autopilot },
    { id:'autonomy',     label:'Autonomy',      icon:IC.autonomy },
    { id:'board',        label:'Operations',    icon:IC.board },
    { id:'agents',       label:'Agents',        icon:IC.agents },
  ]},
  { zone:'Reach', items:[
    { id:'channels',     label:'Channels',      icon:IC.channels },
    { id:'llm',          label:'Models',        icon:IC.llm },
  ]},
  { zone:'System', items:[
    { id:'analytics',    label:'Analytics',     icon:IC.analytics },
    { id:'settings',     label:'Settings',      icon:IC.settings },
  ]},
];

const FLAT_NAV = NAV.flatMap(z => z.items.map(i => ({ ...i, zone: z.zone })));
const PAGE_LABEL = Object.fromEntries(FLAT_NAV.map(i => [i.id, i.label]));

/* ── Sidebar ─────────────────────────────────────────────────── */
function Sidebar({ active, onSelect, collapsed, onToggle, onCmdK }) {
  const W = collapsed ? 56 : 196;
  return (
    <nav style={{
      width: W, flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      transition: 'width .22s cubic-bezier(.2,.7,.3,1)',
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Brand */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '14px 0' : '14px 14px',
        gap: 8, height: 56, flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <CedarMark size={26} />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
              <span style={{ fontFamily: 'var(--fd)', fontSize: 19, color: 'var(--text)', letterSpacing: '.01em' }}>Arz</span>
              <span style={{ fontSize: 9.5, fontFamily: 'var(--fm)', color: 'var(--muted)', marginTop: 2, letterSpacing: '.08em' }}>أرز · cedar</span>
            </div>
          </div>
        )}
        {collapsed && <CedarMark size={26} />}
        {!collapsed && (
          <button onClick={onToggle} style={{
            width: 24, height: 24, background: 'transparent', border: 'none',
            color: 'var(--muted)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{IC.chevL()}</button>
        )}
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(zone => (
          <div key={zone.zone} style={{ marginTop: 10 }}>
            {!collapsed && (
              <div style={{
                fontSize: 9.5, fontFamily: 'var(--fm)', textTransform: 'uppercase',
                letterSpacing: '.14em', color: 'var(--muted)',
                padding: '6px 10px 4px',
              }}>{zone.zone}</div>
            )}
            {collapsed && <div style={{ height: 1, background: 'var(--border)', margin: '6px 12px' }}/>}
            {zone.items.map(({ id, label, icon }) => {
              const isA = id === active;
              return (
                <button key={id} onClick={() => onSelect(id)} title={collapsed ? label : undefined}
                  style={{
                    display: 'flex', alignItems: 'center',
                    gap: collapsed ? 0 : 10,
                    padding: collapsed ? '9px 0' : '7px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background: isA ? 'var(--cedar-dim)' : 'transparent',
                    border: 'none', borderRadius: 7,
                    color: isA ? 'var(--cedar-glow)' : 'var(--text2)',
                    fontSize: 12.5, fontWeight: isA ? 500 : 400,
                    transition: 'all .1s', whiteSpace: 'nowrap', width: '100%',
                    position: 'relative', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!isA) { e.currentTarget.style.background = 'var(--s2)'; e.currentTarget.style.color = 'var(--text)'; } }}
                  onMouseLeave={e => { if (!isA) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; } }}>
                  {isA && <span style={{
                    position: 'absolute', left: collapsed ? 4 : 0, top: '50%', transform: 'translateY(-50%)',
                    width: 2, height: 14, background: 'var(--cedar-glow)', borderRadius: 2,
                  }}/>}
                  {icon(15)}
                  {!collapsed && <span>{label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: collapsed ? '10px 0' : '10px 14px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8,
      }}>
        {collapsed ? (
          <button onClick={onToggle} style={{
            width: 24, height: 24, background: 'transparent', border: 'none',
            color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{IC.chevR()}</button>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserMark size={22} />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 500 }}>You</span>
                <span style={{ fontSize: 9.5, fontFamily: 'var(--fm)', color: 'var(--muted)' }}>v0.1.0-dev</span>
              </div>
            </div>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--cedar-glow)',
              boxShadow: '0 0 6px var(--cedar-glow)',
            }} title="Gateway connected"/>
          </>
        )}
      </div>
    </nav>
  );
}

/* ── Command Palette (⌘K) ───────────────────────────────────── */
function CommandPalette({ open, onClose, onNavigate }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const items = useMemo(() => {
    const ql = q.toLowerCase();
    const pages = FLAT_NAV.map(p => ({ kind:'page', id:p.id, label:p.label, sub:p.zone, icon:p.icon }));
    const sessions = MOCK.SESSIONS.map(s => ({ kind:'session', id:s.id, label:s.title, sub:'Session · '+relTime(s.updated_at), icon:IC.chat }));
    const history = MOCK.HISTORY.map(s => ({ kind:'history', id:s.id, label:s.title, sub:'History · '+relTime(s.updated_at)+' · '+s.msgs+' msgs', icon:IC.chat }));
    const all = [...pages, ...sessions, ...history];
    if (!ql) return [...pages, ...sessions].slice(0, 12);
    return all.filter(i => i.label.toLowerCase().includes(ql) || i.sub.toLowerCase().includes(ql)).slice(0, 16);
  }, [q]);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length-1, i+1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i-1)); }
      if (e.key === 'Enter') { e.preventDefault(); const it = items[idx]; if (it && it.kind === 'page') { onNavigate(it.id); onClose(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, idx, onClose, onNavigate]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose} style={{ display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:'18vh' }}>
      <div onClick={e => e.stopPropagation()} className="fade-up" style={{
        width: 560, maxWidth: '90vw', background: 'var(--surface)',
        border: '1px solid var(--border2)', borderRadius: 14,
        boxShadow: 'var(--shadow-2)', overflow: 'hidden',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
          {IC.search(15)}
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search pages, current chats, history…"
            style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:14, color:'var(--text)', fontFamily:'var(--fn)' }}/>
          <span style={{ fontFamily:'var(--fm)', fontSize:10.5, color:'var(--muted)' }}>esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY:'auto', padding: 6 }}>
          {items.length === 0 && <div style={{ padding:'24px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>No results</div>}
          {items.map((it, i) => (
            <button key={it.kind+it.id} onClick={() => { if (it.kind==='page') { onNavigate(it.id); onClose(); } }}
              onMouseEnter={() => setIdx(i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 12px', background: i===idx ? 'var(--cedar-dim)' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                color: 'var(--text)', fontFamily: 'var(--fn)', marginBottom: 1,
              }}>
              <span style={{ color: i===idx ? 'var(--cedar-glow)' : 'var(--text3)', display:'flex' }}>{it.icon(15)}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{it.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--fm)', marginTop: 1 }}>{it.sub}</div>
              </div>
              {i===idx && <span style={{ fontSize: 10.5, color:'var(--muted)', fontFamily:'var(--fm)' }}>↵</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── TopBar ─────────────────────────────────────────────────── */
function TopBar({ theme, onTheme, onCmdK, page }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', gap:12,
      height:48, flexShrink:0, padding:'0 14px',
      borderBottom:'1px solid var(--border)',
      background:'var(--surface)',
    }}>
      <span style={{ fontSize:11, fontFamily:'var(--fm)', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.14em' }}>
        {PAGE_LABEL[page] || page}
      </span>
      <div style={{ flex:1 }}/>
      <button onClick={onCmdK} style={{
        display:'flex', alignItems:'center', gap:8, height:30, padding:'0 10px',
        background:'var(--bg)', border:'1px solid var(--border)', borderRadius:7,
        color:'var(--text3)', fontSize:12, minWidth:240, cursor:'pointer',
        transition:'border-color .12s, color .12s',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--cedar-line)'; e.currentTarget.style.color='var(--text2)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text3)'; }}>
        {IC.search(13)}
        <span style={{ flex:1, textAlign:'left' }}>Search pages, chats, history…</span>
        <span style={{ fontFamily:'var(--fm)', fontSize:10, padding:'1px 5px', border:'1px solid var(--border)', borderRadius:3, color:'var(--muted)' }}>⌘K</span>
      </button>
      <div style={{ display:'inline-flex', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:8, padding:2, height:30 }}>
        {[
          { v:'light', icon:(<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4"/></g></svg>) },
          { v:'dark',  icon:(<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M12.5 9.5A5 5 0 0 1 6.5 3.5 5 5 0 1 0 12.5 9.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>) },
        ].map(opt => {
          const on = theme === opt.v;
          return (
            <button key={opt.v} onClick={() => onTheme(opt.v)} title={opt.v}
              style={{
                width:30, height:24, borderRadius:6, border:'none',
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--cedar-glow)' : 'var(--text3)',
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: on ? 'inset 0 0 0 1px var(--cedar-line)' : 'none',
                transition:'all .12s',
              }}>{opt.icon}</button>
          );
        })}
      </div>
      <button title="Notifications" style={{ width:30, height:30, borderRadius:7, border:'1px solid var(--border)', background:'var(--s2)', color:'var(--text2)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 11.5h9l-1-1.5V7a3.5 3.5 0 1 0-7 0v3l-1 1.5z M7 13.5a1.2 1.2 0 0 0 2 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <UserMark size={26}/>
    </header>
  );
}

Object.assign(window, { NAV, FLAT_NAV, PAGE_LABEL, Sidebar, CommandPalette, TopBar });
