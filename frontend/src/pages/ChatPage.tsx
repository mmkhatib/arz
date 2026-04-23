import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { SessionSummary } from "@/api/client";
import SessionList from "@/components/SessionList";
import ChatPanel from "@/components/ChatPanel";
import SettingsModal from "@/components/SettingsModal";

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

      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
        {activeId ? (
          <ChatPanel key={activeId} sessionId={activeId} />
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
      </main>
    </div>
  );
}
