import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { SessionSummary } from "@/api/client";
import SessionList from "@/components/SessionList";
import ChatPanel from "@/components/ChatPanel";
import SettingsModal from "@/components/SettingsModal";
import ActivityPane, { type ToolEntry } from "@/components/ActivityPane";

interface SseLogEntry {
  type: string;
  time: string;
  summary?: string;
}

export default function ChatPage() {
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
  const [showSettings, setShowSettings] = useState(false);
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

  const loadSessions = async () => {
    try {
      const data = await api.fetchSessions();
      setSessions(data);
      if (!activeId && data.length > 0) setActiveId(data[0].id);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 30_000);
    return () => clearInterval(interval);
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
      // Truncate result to 1000 chars each to bound storage size
      const slim = toolEntries.map((e) => ({
        ...e,
        result: e.result ? e.result.slice(0, 1000) : e.result,
      }));
      localStorage.setItem(`arz:activity:${activeId}`, JSON.stringify(slim));
    } catch {}
  }, [activeId, toolEntries]);

  const handleCreate = async () => {
    try {
      const session = await api.createSession();
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

  const handleSelect = (id: string) => setActiveId(id);

  const handleSeedFiles = (paths: string[]) => setSeedPaths((prev) => {
    const existing = new Set(prev);
    const next = paths.filter((p) => !existing.has(p));
    return next.length > 0 ? [...prev, ...next] : prev;
  });

  const handleFileOpen = (path: string) => {
    setActivityOpen(true);
    setRequestedFile(path);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-[var(--muted)]">
        <span className="animate-pulse text-3xl">🌲</span>
      </div>
    );
  }

  return (
    <div className="flex w-full h-full overflow-hidden">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <SessionList
        sessions={sessions}
        activeId={activeId}
        pinnedIds={pinnedIds}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onSettings={() => setShowSettings(true)}
      />

      <main className="flex-1 min-w-0 flex bg-[var(--bg)] overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col">
          {activeId ? (
            <ChatPanel
              key={activeId}
              sessionId={activeId}
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
          />
        )}
      </main>
    </div>
  );
}
