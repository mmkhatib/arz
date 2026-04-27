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
  work_dir?: string | null;
  provider?: string | null;
  approval_mode?: "normal" | "trust_reads" | "trust" | "yolo";
}

export interface UsageRecord {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface MessageRecord {
  role: "user" | "assistant" | "system";
  text: string;
  created_at: string;
  /** Tool calls made during this message (assistant only) */
  tool_calls?: { name: string; input: string }[];
  /** Wall time in milliseconds from send to complete (assistant only) */
  elapsed_ms?: number;
  /** Token usage reported by the provider on EVENT_COMPLETE (assistant only) */
  usage?: UsageRecord;
  /** Model that produced this assistant message (recorded at completion time) */
  model?: string;
}

export interface SessionDetail extends SessionSummary {
  messages: MessageRecord[];
}

export interface ToolView {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  source_path: string;
  error?: string | null;
}

export interface CronEntry {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  created_at: number;
  last_run_at: number | null;
  last_status: string | null;
  last_session_id: string | null;
}

export interface MemoryLesson {
  id: number;
  content: string;
  tags: string[];
  created_at: number;
}

export interface MemoryHit {
  key: string;
  content: string;
  score: number;
  source: "vector" | "markdown";
}

export interface UploadedFile {
  path: string;
  rel_path: string;
  name: string;
  ext: string;
  size: number;
}

export interface SearchHit {
  session_id: string;
  session_title: string;
  message_idx: number;
  role: string;
  provider: string;
  updated_at: string;
  snippet: string;
  rank: number;
}

export interface Settings {
  provider: "claude-code" | "kiro-cli" | "anthropic";
  model: string;
  bot_name: string;
  host: string;
  port: number;
  token_auth: boolean;
  system_prompt: string;
  log_level: string;
  auto_recall: boolean;
  recall_k: number;
}

export interface SSEChunk {
  type: "text_chunk" | "complete" | "error" | "tool_call" | "tool_result" | "permission_request";
  text?: string;
  stop_reason?: string;
  context_pct?: number;
  usage?: UsageRecord;
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

  createSession: (provider?: string, surface = "dashboard", chat_id = "web") =>
    request<SessionSummary>("/sessions", {
      method: "POST",
      body: JSON.stringify({ surface, chat_id, ...(provider ? { provider } : {}) }),
    }),

  fetchHistory: () => request<SessionSummary[]>("/sessions/history"),

  reactivateSession: (id: string) =>
    request<SessionSummary>(`/sessions/${id}/reactivate`, { method: "POST" }),

  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),

  deleteSession: (id: string) =>
    fetch(`${BASE}/sessions/${id}`, { method: "DELETE" }),

  permanentDeleteSession: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/sessions/${id}/permanent`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  },

  renameSession: async (id: string, title: string): Promise<void> => {
    const res = await fetch(`${BASE}/sessions/${id}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  },

  /** Send a message; returns the raw Response for SSE streaming. */
  sendMessage: (sessionId: string, message: string): Promise<Response> =>
    fetch(`${BASE}/chat/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }),

  searchSessions: (q: string) => request<SessionSummary[]>(`/sessions/search?q=${encodeURIComponent(q)}`),

  exportSessionUrl: (sessionId: string, format: "markdown" | "json") =>
    `${BASE}/sessions/${sessionId}/export?format=${format}`,

  // ── Memory ──
  memoryListMarkdown: () => request<string[]>("/memory/markdown"),
  memoryReadMarkdown: (key: string) =>
    request<{ key: string; content: string }>(`/memory/markdown/${encodeURIComponent(key)}`),
  memoryWriteMarkdown: (key: string, content: string) =>
    request<{ key: string; content: string }>(`/memory/markdown/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  memoryDeleteMarkdown: async (key: string): Promise<void> => {
    const res = await fetch(`${BASE}/memory/markdown/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  },
  memoryListLessons: () => request<MemoryLesson[]>("/memory/lessons"),
  memoryCreateLesson: (content: string, tags: string[] = []) =>
    request<MemoryLesson>("/memory/lessons", {
      method: "POST",
      body: JSON.stringify({ content, tags }),
    }),
  memoryDeleteLesson: async (id: number): Promise<void> => {
    const res = await fetch(`${BASE}/memory/lessons/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  },
  memorySearch: (q: string, k = 5) =>
    request<MemoryHit[]>(`/memory/search?q=${encodeURIComponent(q)}&k=${k}`),

  // ── Cron ──
  listCrons: () => request<CronEntry[]>("/cron"),
  createCron: (name: string, prompt: string, schedule: string, enabled = true) =>
    request<CronEntry>("/cron", {
      method: "POST",
      body: JSON.stringify({ name, prompt, schedule, enabled }),
    }),
  updateCron: (id: number, patch: Partial<{ name: string; prompt: string; schedule: string; enabled: boolean }>) =>
    request<CronEntry>(`/cron/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCron: async (id: number): Promise<void> => {
    const res = await fetch(`${BASE}/cron/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  },
  runCronNow: (id: number) =>
    request<{ queued: boolean }>(`/cron/${id}/run`, { method: "POST" }),

  // ── Tools ──
  listTools: () => request<ToolView[]>("/tools"),
  reloadTools: () => request<{ loaded: number }>("/tools/reload", { method: "POST" }),
  invokeTool: (name: string, input: Record<string, unknown>) =>
    request<{ result: string }>(`/tools/${encodeURIComponent(name)}/invoke`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),

  // ── Analytics ──
  analyticsMessagesByDay: (days = 30) =>
    request<{ date: string; count: number }[]>(`/analytics/messages-by-day?days=${days}`),
  analyticsTokensByDay: (days = 30) =>
    request<{ date: string; count: number }[]>(`/analytics/tokens-by-day?days=${days}`),
  analyticsToolUsage: () =>
    request<{ name: string; count: number }[]>("/analytics/tool-usage"),
  analyticsProviders: () =>
    request<{ provider: string; messages: number }[]>("/analytics/providers"),
  analyticsLatency: () =>
    request<{ provider: string; samples: number; p50_ms: number; p95_ms: number; avg_ms: number }[]>(
      "/analytics/latency",
    ),
  analyticsCsvUrl: () => `${BASE}/analytics/export.csv`,

  // ── Compare ──
  compareStream: (prompt: string, provider: string, model: string): Promise<Response> =>
    fetch(`${BASE}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, provider, model }),
    }),

  uploadFiles: async (sessionId: string, files: File[]): Promise<UploadedFile[]> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch(`${BASE}/sessions/${sessionId}/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json() as Promise<UploadedFile[]>;
  },

  searchMessages: (q: string, opts?: { provider?: string; since?: string; until?: string; limit?: number }) => {
    const params = new URLSearchParams({ q });
    if (opts?.provider) params.set("provider", opts.provider);
    if (opts?.since) params.set("since", opts.since);
    if (opts?.until) params.set("until", opts.until);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return request<SearchHit[]>(`/search?${params.toString()}`);
  },

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

  async evictSession(sessionId: string): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}/evict`, { method: "POST" });
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

  async setWorkDir(sessionId: string, path: string): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}/workdir`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },

  async readFile(path: string): Promise<{ content: string; path: string; name: string; size: number }> {
    return request<{ content: string; path: string; name: string; size: number }>(
      `/files/read?path=${encodeURIComponent(path)}`
    );
  },

  fetchSessionFiles: (id: string) =>
    request<{ path: string; rel_path: string; name: string; ext: string; size: number }[]>(
      `/sessions/${id}/files`
    ),

  async generateTitle(sessionId: string, userMsg?: string, assistantMsg?: string): Promise<string> {
    const body: Record<string, string> = {};
    if (userMsg) body.user_msg = userMsg;
    if (assistantMsg) body.assistant_msg = assistantMsg;
    const res = await fetch(`${BASE}/sessions/${sessionId}/generate-title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
