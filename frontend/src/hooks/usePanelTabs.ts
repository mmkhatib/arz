/** Tab state for the chat side panel, kept per session in localStorage.
 *
 *  Three views are pinned (always present, not closable): Files, Changes,
 *  Tools. Everything else is opened on demand and closable:
 *    - single-instance views from the "+" menu: tasks, context, subagents, logs
 *    - document tabs: `file:<abs path>` (viewer) and `diff:<abs path>`
 *
 *  Only tab ids are stored — never file contents — so restoring a session
 *  reopens the same tabs and each one refetches what it shows.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

export type PanelView = "files" | "changes" | "tools" | "tasks" | "context" | "subagents" | "logs";
export type PanelTabId = PanelView | `file:${string}` | `diff:${string}`;

export const PINNED_VIEWS: PanelView[] = ["files", "changes", "tools"];
export const MENU_VIEWS: PanelView[] = ["tasks", "context", "subagents", "logs"];
const ALL_VIEWS = new Set<string>([...PINNED_VIEWS, ...MENU_VIEWS]);
const MAX_OPEN_TABS = 12;

export interface PanelTabsState {
  /** Non-pinned open tabs, in strip order. */
  open: PanelTabId[];
  active: PanelTabId;
}

export type PanelTabsAction =
  | { type: "open"; id: PanelTabId }
  /** Add a tab without stealing focus (auto-surfaced views). */
  | { type: "add"; id: PanelTabId }
  | { type: "close"; id: PanelTabId }
  | { type: "activate"; id: PanelTabId }
  | { type: "reset"; state: PanelTabsState };

export const DEFAULT_PANEL_TABS: PanelTabsState = { open: [], active: "files" };

export function isPinned(id: PanelTabId): boolean {
  return (PINNED_VIEWS as string[]).includes(id);
}

export function isValidTabId(id: unknown): id is PanelTabId {
  if (typeof id !== "string") return false;
  if (ALL_VIEWS.has(id)) return true;
  return /^(file|diff):\/./.test(id) || /^(file|diff):[A-Za-z]:[\\/]/.test(id);
}

export function tabPath(id: PanelTabId): string | null {
  const m = /^(?:file|diff):(.+)$/.exec(id);
  return m ? m[1] : null;
}

export function panelTabsReducer(state: PanelTabsState, action: PanelTabsAction): PanelTabsState {
  switch (action.type) {
    case "open": {
      if (isPinned(action.id) || state.open.includes(action.id)) {
        return state.active === action.id ? state : { ...state, active: action.id };
      }
      let open = [...state.open, action.id];
      // Evict the oldest non-active document tab once the strip gets long.
      while (open.length > MAX_OPEN_TABS) {
        const victim = open.find((t) => t !== action.id && tabPath(t) !== null) ?? open[0];
        open = open.filter((t) => t !== victim);
      }
      return { open, active: action.id };
    }
    case "add": {
      if (isPinned(action.id) || state.open.includes(action.id)) return state;
      return { ...state, open: [...state.open, action.id] };
    }
    case "close": {
      if (isPinned(action.id) || !state.open.includes(action.id)) return state;
      const idx = state.open.indexOf(action.id);
      const open = state.open.filter((t) => t !== action.id);
      let active = state.active;
      if (active === action.id) {
        // Prefer the tab to the left, like an editor; fall back to Files.
        active = open[idx - 1] ?? open[idx] ?? "files";
      }
      return { open, active };
    }
    case "activate":
      if (!isPinned(action.id) && !state.open.includes(action.id)) return state;
      return state.active === action.id ? state : { ...state, active: action.id };
    case "reset":
      return { ...action.state };
  }
}

/** Parse a persisted blob, dropping anything malformed. */
export function loadPanelTabs(raw: string | null): PanelTabsState {
  if (!raw) return DEFAULT_PANEL_TABS;
  try {
    const v = JSON.parse(raw) as Partial<PanelTabsState>;
    const open = Array.isArray(v.open)
      ? v.open.filter((t): t is PanelTabId => isValidTabId(t) && !isPinned(t as PanelTabId))
      : [];
    const deduped = [...new Set(open)].slice(-MAX_OPEN_TABS);
    const active =
      isValidTabId(v.active) && (isPinned(v.active) || deduped.includes(v.active)) ? v.active : "files";
    return { open: deduped, active };
  } catch {
    return DEFAULT_PANEL_TABS;
  }
}

const key = (sessionId: string) => `arz:panel:${sessionId}`;

export function usePanelTabs(sessionId: string) {
  const [state, dispatch] = useReducer(panelTabsReducer, DEFAULT_PANEL_TABS, () => {
    try {
      return loadPanelTabs(localStorage.getItem(key(sessionId)));
    } catch {
      return DEFAULT_PANEL_TABS;
    }
  });

  // ActivityPane stays mounted across session switches, so reload when
  // the session changes rather than relying on a remount. `skipSave`
  // stops the save effect (same commit) from writing the previous
  // session's tabs under the new session's key before the reset lands.
  const loadedFor = useRef(sessionId);
  const skipSave = useRef(false);
  useEffect(() => {
    if (loadedFor.current === sessionId) return;
    loadedFor.current = sessionId;
    skipSave.current = true;
    try {
      dispatch({ type: "reset", state: loadPanelTabs(localStorage.getItem(key(sessionId))) });
    } catch {
      dispatch({ type: "reset", state: DEFAULT_PANEL_TABS });
    }
  }, [sessionId]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(key(sessionId), JSON.stringify(state));
    } catch {
      /* storage full / disabled — tabs just won't persist */
    }
  }, [sessionId, state]);

  const open = useCallback((id: PanelTabId) => dispatch({ type: "open", id }), []);
  const add = useCallback((id: PanelTabId) => dispatch({ type: "add", id }), []);
  const close = useCallback((id: PanelTabId) => dispatch({ type: "close", id }), []);
  const activate = useCallback((id: PanelTabId) => dispatch({ type: "activate", id }), []);
  return { state, open, add, close, activate };
}
