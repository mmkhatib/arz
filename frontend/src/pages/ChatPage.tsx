import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { SessionSummary } from "@/api/client";
import SessionList from "@/components/SessionList";
import ChatPanel from "@/components/ChatPanel";
import NewSessionModal from "@/components/NewSessionModal";
import ActivityPane, { type ToolEntry } from "@/components/ActivityPane";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { chatPath, readSessionIdFromUrl } from "@/utils/sessionUrl";

interface SseLogEntry {
  type: string;
  time: string;
  summary?: string;
}

export default function ChatPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("arz:pinned");
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [loading, setLoading] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [globalProvider, setGlobalProvider] = useState("claude-code");
  const [activityOpen, setActivityOpen] = useState(false);
  const [toolEntries, setToolEntries] = useState<ToolEntry[]>([]);
  const [sseLog, setSseLog] = useState<SseLogEntry[]>([]);
  const [activityWidth, setActivityWidth] = useState<number>(() => {
    const saved = localStorage.getItem("arz:activity-width");
    const n = saved ? parseInt(saved, 10) : NaN;
    return !isNaN(n) && n >= 220 && n <= 600 ? n : 300;
  });
  const [seedPaths, setSeedPaths] = useState<string[]>([]);
  const [requestedFile, setRequestedFile] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadSessions = async () => {
    try {
      const data = await api.fetchSessions();
      setSessions(data);
      // Auto-select on first load only. Use the functional setter form so we
      // see the current activeId — never clobber a user-picked session on
      // subsequent polls (this is what was making the chat flip back to the
      // top of the list every refresh cycle).
      setActiveId((prev) => {
        // One-shot hint from another page (e.g. AgentsModal "Start session").
        const hinted = sessionStorage.getItem("arz:next-session");
        if (hinted && data.find((s) => s.id === hinted)) {
          sessionStorage.removeItem("arz:next-session");
          return hinted;
        }
        if (prev) return prev;
        if (data.length === 0) return null;
        // Check the URL — supports /chat/<slug>?sid=ID (current),
        // ?session=ID, ?slot=ID, and the legacy #session=ID hash.
        const fromUrl = readSessionIdFromUrl();
        if (fromUrl && data.find((s) => s.id === fromUrl)) return fromUrl;
        return data[0].id;
      });
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  };

  // Keep the URL in sync with the active session — produces the
  // bookmarkable /chat/<slug>?sid=<id> shape. Title-driven slug means
  // a rename updates the URL automatically. We use replace (not push)
  // to avoid spamming browser history on tab switches.
  useEffect(() => {
    if (!activeId) return;
    const sess = sessions.find((s) => s.id === activeId);
    const target = chatPath(sess?.title, activeId);
    const current = window.location.pathname + window.location.search;
    if (current !== target) {
      navigate(target, { replace: true });
    }
  }, [activeId, sessions, navigate]);

  // Load global provider for use as default in NewSessionModal
  useEffect(() => {
    api.getSettings().then((s) => setGlobalProvider(s.provider)).catch(() => {});
  }, []);

  // Cron badge polling now lives in Layout so it's visible on every page,
  // not just /. See pages/Layout.tsx.

  useEffect(() => {
    loadSessions();
    // Single steady-state poll. We poll relatively often (5s) so the
    // streaming indicator dot updates promptly when a turn starts or
    // finishes — but with NO deps on `sessions`, otherwise updating
    // sessions would re-fire this effect, kick off another loadSessions,
    // and tight-loop.
    const tick = () => { if (!document.hidden) loadSessions(); };
    const interval = setInterval(tick, 5_000);
    const onVisible = () => { if (!document.hidden) loadSessions(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // On session switch: load persisted activity from localStorage instead of clearing
  useEffect(() => {
    setSseLog([]);
    setSeedPaths([]);
    setRequestedFile(null);
    if (!activeId) { setToolEntries([]); return; }
    try {
      const raw = localStorage.getItem(`arz:activity:${activeId}`);
      setToolEntries(raw ? (JSON.parse(raw) as ToolEntry[]) : []);
    } catch {
      setToolEntries([]);
    }
  }, [activeId]);

  // Persist toolEntries to localStorage whenever they change
  useEffect(() => {
    if (!activeId || toolEntries.length === 0) return;
    try {
      const slim = toolEntries.map((e) => ({
        ...e,
        result: e.result ? e.result.slice(0, 1000) : e.result,
      }));
      localStorage.setItem(`arz:activity:${activeId}`, JSON.stringify(slim));
    } catch {}
  }, [activeId, toolEntries]);

  const handleCreate = () => {
    setShowNewSession(true);
  };

  const handleNewSessionConfirm = async (provider: string, _agentName?: string) => {
    setShowNewSession(false);
    try {
      const session = await api.createSession(provider);
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
    } catch (e) {
      console.error("Failed to create session:", e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSession(id);
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        if (activeId === id) {
          setActiveId(remaining.length > 0 ? remaining[0].id : null);
        }
        return remaining;
      });
      setPinnedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const handleTogglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("arz:pinned", JSON.stringify([...next]));
      return next;
    });
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setFocusTick((n) => n + 1);
  };

  const handleResume = async (session: SessionSummary) => {
    try {
      const reactivated = await api.reactivateSession(session.id);
      setSessions((prev) => {
        const exists = prev.find((s) => s.id === reactivated.id);
        if (exists) return prev.map((s) => s.id === reactivated.id ? reactivated : s);
        return [reactivated, ...prev];
      });
      setActiveId(reactivated.id);
    } catch (e) {
      console.error("Failed to resume session:", e);
    }
  };

  const handleSeedFiles = (paths: string[]) => setSeedPaths((prev) => {
    const existing = new Set(prev);
    const next = paths.filter((p) => !existing.has(p));
    return next.length > 0 ? [...prev, ...next] : prev;
  });

  const handleFileOpen = (path: string) => {
    setActivityOpen(true);
    setRequestedFile(path);
  };

  const handleSpawnFromTask = async (prompt: string) => {
    try {
      const session = await api.createSession(globalProvider);
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
      // Stash the prompt so ChatPanel can auto-send it on mount
      sessionStorage.setItem(`arz:autosend:${session.id}`, prompt);
    } catch (e) {
      console.error("Failed to spawn session from task:", e);
    }
  };

  const navigateSession = (delta: 1 | -1) => {
    if (sessions.length === 0) return;
    const idx = activeId ? sessions.findIndex((s) => s.id === activeId) : -1;
    const start = idx === -1 ? 0 : idx;
    const next = (start + delta + sessions.length) % sessions.length;
    setActiveId(sessions[next].id);
  };

  useKeyboardShortcuts({
    "mod+k": () => setShowNewSession(true),
    "mod+f": () => searchInputRef.current?.focus(),
    "mod+[": () => navigateSession(-1),
    "mod+]": () => navigateSession(1),
    "mod+w": () => activeId && handleDelete(activeId),
    "?": () => navigate("/shortcuts"),
    esc: () => {
      if (showNewSession) setShowNewSession(false);
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-[var(--muted)]">
        <span className="animate-pulse text-3xl">🌲</span>
      </div>
    );
  }

  return (
    <>
      {showNewSession && (
        <NewSessionModal
          defaultProvider={globalProvider}
          onConfirm={handleNewSessionConfirm}
          onCancel={() => setShowNewSession(false)}
        />
      )}

      <SessionList
        sessions={sessions}
        activeId={activeId}
        pinnedIds={pinnedIds}
        globalProvider={globalProvider}
        searchInputRef={searchInputRef}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
        onSelect={(id) => { setMobileSidebarOpen(false); handleSelect(id); }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onResume={handleResume}
      />

      <main className="flex-1 min-w-0 flex bg-[var(--bg)] overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col">
          {activeId ? (
            <ChatPanel
              key={activeId}
              sessionId={activeId}
              focusSignal={focusTick}
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onToolCall={(tc) => setToolEntries((prev) => [...prev, { ...tc, done: false }])}
              onToolResult={(callId, content) => setToolEntries((prev) =>
                prev.map((e) => e.callId === callId ? { ...e, result: content, done: true } : e)
              )}
              onTitleChange={(title) => setSessions((prev) =>
                prev.map((s) => s.id === activeId ? { ...s, title } : s)
              )}
              onSseEvent={(type, summary) => setSseLog((prev) => [
                ...prev,
                { type, summary, time: new Date().toLocaleTimeString() },
              ])}
              onSeedFiles={handleSeedFiles}
              onFileOpen={handleFileOpen}
              activityOpen={activityOpen}
              onToggleActivity={() => setActivityOpen((v) => !v)}
              onSessionForked={async (newId) => {
                await loadSessions();
                setActiveId(newId);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="text-6xl mb-4">🌲</span>
              <h1 className="text-[var(--text)] text-2xl font-semibold mb-3">Welcome to Arz</h1>
              <p className="text-[var(--muted)] text-[15px] max-w-sm mb-6">
                Your cedar in the cloud — rooted, persistent, always here.
              </p>
              <button
                onClick={handleCreate}
                className="px-5 py-2.5 rounded-xl bg-[var(--cedar)] text-white text-[14px] font-medium hover:bg-[var(--cedar-lt)] transition-colors"
              >
                Start a session
              </button>
            </div>
          )}
        </div>
        {activityOpen && activeId && (
          <ActivityPane
            sessionId={activeId}
            toolEntries={toolEntries}
            sseLog={sseLog}
            seedPaths={seedPaths}
            requestedFile={requestedFile}
            onFileOpenHandled={() => setRequestedFile(null)}
            onClose={() => setActivityOpen(false)}
            width={activityWidth}
            onWidthChange={setActivityWidth}
            onSpawnSession={handleSpawnFromTask}
          />
        )}
      </main>
    </>
  );
}
