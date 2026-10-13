import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_TABS,
  isValidTabId,
  loadPanelTabs,
  panelTabsReducer,
  tabPath,
  type PanelTabsState,
} from "@/hooks/usePanelTabs";
import { collectFileChanges, editsAsDiffPair, latestTodos, todoProgress } from "@/utils/panelData";
import type { ToolEntry } from "@/components/ActivityPane";

const entry = (name: string, input: unknown, time = "12:00:00"): ToolEntry => ({
  callId: `${name}-${Math.random()}`,
  name,
  input: typeof input === "string" ? input : JSON.stringify(input),
  done: true,
  time,
});

describe("panelTabsReducer", () => {
  it("opens a document tab and focuses it", () => {
    const s = panelTabsReducer(DEFAULT_PANEL_TABS, { type: "open", id: "file:/a.ts" });
    expect(s).toEqual({ open: ["file:/a.ts"], active: "file:/a.ts" });
  });

  it("re-opening an existing tab only focuses it", () => {
    let s = panelTabsReducer(DEFAULT_PANEL_TABS, { type: "open", id: "file:/a.ts" });
    s = panelTabsReducer(s, { type: "activate", id: "tools" });
    s = panelTabsReducer(s, { type: "open", id: "file:/a.ts" });
    expect(s.open).toEqual(["file:/a.ts"]);
    expect(s.active).toBe("file:/a.ts");
  });

  it("pinned views are never added to the open list or closed", () => {
    let s = panelTabsReducer(DEFAULT_PANEL_TABS, { type: "open", id: "changes" });
    expect(s).toEqual({ open: [], active: "changes" });
    s = panelTabsReducer(s, { type: "close", id: "changes" });
    expect(s.active).toBe("changes");
  });

  it("closing the active tab focuses its left neighbour, then Files", () => {
    let s: PanelTabsState = { open: ["tasks", "file:/a", "diff:/b"], active: "file:/a" };
    s = panelTabsReducer(s, { type: "close", id: "file:/a" });
    expect(s).toEqual({ open: ["tasks", "diff:/b"], active: "tasks" });
    s = panelTabsReducer({ open: ["tasks"], active: "tasks" }, { type: "close", id: "tasks" });
    expect(s).toEqual({ open: [], active: "files" });
  });

  it("closing an inactive tab keeps focus", () => {
    const s = panelTabsReducer({ open: ["tasks", "logs"], active: "logs" }, { type: "close", id: "tasks" });
    expect(s).toEqual({ open: ["logs"], active: "logs" });
  });

  it("add surfaces a tab without stealing focus", () => {
    const s = panelTabsReducer({ open: [], active: "tools" }, { type: "add", id: "tasks" });
    expect(s).toEqual({ open: ["tasks"], active: "tools" });
  });

  it("activate ignores tabs that aren't open", () => {
    const s = panelTabsReducer(DEFAULT_PANEL_TABS, { type: "activate", id: "logs" });
    expect(s).toBe(DEFAULT_PANEL_TABS);
  });

  it("evicts the oldest document tab past the cap", () => {
    let s = DEFAULT_PANEL_TABS;
    for (let i = 0; i < 14; i++) s = panelTabsReducer(s, { type: "open", id: `file:/f${i}` });
    expect(s.open.length).toBe(12);
    expect(s.open).not.toContain("file:/f0");
    expect(s.active).toBe("file:/f13");
  });
});

describe("loadPanelTabs", () => {
  it("restores a valid blob", () => {
    const raw = JSON.stringify({ open: ["context", "file:/x/y.md"], active: "file:/x/y.md" });
    expect(loadPanelTabs(raw)).toEqual({ open: ["context", "file:/x/y.md"], active: "file:/x/y.md" });
  });

  it("drops junk ids, pinned ids, and a dangling active", () => {
    const raw = JSON.stringify({ open: ["bogus", "files", "file:relative", "logs", "logs"], active: "tasks" });
    expect(loadPanelTabs(raw)).toEqual({ open: ["logs"], active: "files" });
  });

  it("survives null and malformed JSON", () => {
    expect(loadPanelTabs(null)).toEqual(DEFAULT_PANEL_TABS);
    expect(loadPanelTabs("{nope")).toEqual(DEFAULT_PANEL_TABS);
  });

  it("validates ids and extracts paths", () => {
    expect(isValidTabId("diff:/a/b.ts")).toBe(true);
    expect(isValidTabId("file:C:\\x.txt")).toBe(true);
    expect(isValidTabId("file:")).toBe(false);
    expect(tabPath("diff:/a/b.ts")).toBe("/a/b.ts");
    expect(tabPath("tools")).toBeNull();
  });
});

describe("collectFileChanges", () => {
  it("folds edits per file, newest file first, with +/- counts", () => {
    const changes = collectFileChanges([
      entry("Write", { file_path: "/w/new.py", content: "a\nb\n" }, "10:00:00"),
      entry("Edit", { file_path: "/w/old.py", old_string: "x = 1", new_string: "x = 2" }, "10:01:00"),
      entry("Read", { file_path: "/w/other.py" }),
      entry(
        "MultiEdit",
        { file_path: "/w/new.py", edits: [{ old_string: "a", new_string: "A" }, { old_string: "b", new_string: "B\nC" }] },
        "10:02:00",
      ),
    ]);
    expect(changes.map((c) => c.path)).toEqual(["/w/old.py", "/w/new.py"]);
    const created = changes[1];
    expect(created.created).toBe(true);
    expect(created.edits.length).toBe(3);
    expect(created.added).toBe(2 + 1 + 2);
    expect(created.removed).toBe(0 + 1 + 1);
    expect(created.lastTime).toBe("10:02:00");
    expect(changes[0]).toMatchObject({ created: false, added: 1, removed: 1 });
  });

  it("reads Claude Code's python-repr wrapped input", () => {
    const inner = JSON.stringify({ file_path: "/w/a.ts", old_string: "1", new_string: "2" });
    const wrapped = `{'raw': '${inner.replace(/"/g, '\\"')}'}`;
    expect(collectFileChanges([entry("Edit", wrapped)]).map((c) => c.path)).toEqual(["/w/a.ts"]);
  });

  it("stitches multiple edits into one diff pair with markers", () => {
    const [c] = collectFileChanges([
      entry("Edit", { file_path: "/a", old_string: "one", new_string: "ONE" }),
      entry("Edit", { file_path: "/a", old_string: "two", new_string: "TWO" }),
    ]);
    const pair = editsAsDiffPair(c);
    expect(pair.original).toContain("one");
    expect(pair.original).toContain("two");
    expect(pair.modified).toContain("ONE");
    expect(pair.original.split("── edit").length - 1).toBe(2);
    const [single] = collectFileChanges([entry("Edit", { file_path: "/b", old_string: "x", new_string: "y" })]);
    expect(editsAsDiffPair(single)).toEqual({ original: "x", modified: "y" });
  });
});

describe("latestTodos", () => {
  it("returns null when no todo tool ran", () => {
    expect(latestTodos([entry("Bash", { command: "ls" })])).toBeNull();
  });

  it("takes the most recent TodoWrite and normalises statuses", () => {
    const todos = latestTodos([
      entry("TodoWrite", { todos: [{ content: "old", status: "pending" }] }),
      entry("Bash", { command: "ls" }),
      entry("TodoWrite", {
        todos: [
          { content: "Plan", status: "completed" },
          { content: "Build", status: "in_progress", activeForm: "Building" },
          { content: "Ship", status: "pending" },
          { title: "Alt shape", status: "done" },
          { status: "pending" },
        ],
      }),
    ]);
    expect(todos).toEqual([
      { content: "Plan", status: "completed", activeForm: undefined },
      { content: "Build", status: "in_progress", activeForm: "Building" },
      { content: "Ship", status: "pending", activeForm: undefined },
      { content: "Alt shape", status: "completed", activeForm: undefined },
    ]);
    expect(todoProgress(todos!)).toEqual({ done: 2, total: 4 });
  });
});
