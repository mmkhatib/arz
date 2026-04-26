const BASE = "/api";

export interface SessionSummary {
  id: string;
  title: string;
  surface: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  active: boolean;
  color?: number | null;
}

export interface MessageRecord {
  role: "user" | "assistant" | "system";
  text: string;
  created_at: string;
}

export interface SessionDetail extends SessionSummary {
  messages: MessageRecord[];
}

export interface Settings {
  provider: "claude-code" | "kiro-cli" | "anthropic";
  model: string;
}

export interface SSEChunk {
  type: "text_chunk" | "complete" | "error" | "tool_call" | "tool_result" | "permission_request";
  text?: string;
  stop_reason?: string;
  context_pct?: number;
  message?: string;
  tool_name?: string;
  tool_input?: string;
  tool_call_id?: string;
  content?: string;
  request_id?: string;
  title?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  fetchSessions: () => request<SessionSummary[]>("/sessions"),

  createSession: (surface = "dashboard", chat_id = "web") =>
    request<SessionSummary>("/sessions", {
      method: "POST",
      body: JSON.stringify({ surface, chat_id }),
    }),

  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),

  deleteSession: (id: string) =>
    fetch(`${BASE}/sessions/${id}`, { method: "DELETE" }),

  /** Send a message; returns the raw Response for SSE streaming. */
  sendMessage: (sessionId: string, message: string): Promise<Response> =>
    fetch(`${BASE}/chat/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }),

  searchSessions: (q: string) => request<SessionSummary[]>(`/sessions/search?q=${encodeURIComponent(q)}`),

  getSettings: () => request<Settings>("/settings"),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  async setSessionColor(id: string, color: number | null): Promise<void> {
    await fetch(`${BASE}/sessions/${id}/color`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
  },
  async approveRequest(requestId: string): Promise<void> {
    await fetch(`${BASE}/approvals/${requestId}/approve`, {
      method: "POST",
    });
  },
  async rejectRequest(requestId: string): Promise<void> {
    await fetch(`${BASE}/approvals/${requestId}/reject`, {
      method: "POST",
    });
  },

  async toggleYolo(sessionId: string): Promise<{ yolo: boolean }> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/yolo`, { method: "POST" });
    return res.json() as Promise<{ yolo: boolean }>;
  },

  async setApprovalMode(sessionId: string, mode: string): Promise<{ mode: string }> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) return { mode };
    return res.json() as Promise<{ mode: string }>;
  },

  async generateTitle(sessionId: string, userMsg: string, assistantMsg: string): Promise<string> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/generate-title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_msg: userMsg, assistant_msg: assistantMsg }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { title: string };
    return data.title || "";
  },

  /** Parse an SSE response body into chunks via async iteration. */
  async *streamChat(response: Response): AsyncGenerator<SSEChunk> {
    if (!response.body) throw new Error("No response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6)) as SSEChunk;
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  },
};
