import { describe, it, expect } from "vitest";
import { diffLines, diffStats, parseUnifiedDiff, unifiedDiffPath, withContext } from "@/utils/lineDiff";
import { extractEditChanges, inferToolStatus, parseToolInput, toolSummary, truncateLines } from "@/utils/toolInput";
import { classifyError } from "@/utils/errorKind";
import { isPathCandidate, splitLineRef } from "@/utils/pathRefs";
import { holdOpenMermaid, openFence, rowsToCsv, rowsToMarkdown } from "@/utils/markdownTools";

describe("diffLines", () => {
  it("marks a changed line as del + add around shared context", () => {
    const out = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(out).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "ctx", text: "c" },
    ]);
  });

  it("handles pure insertions and deletions", () => {
    expect(diffStats(diffLines("", "x\ny"))).toEqual({ added: 2, removed: 0 });
    expect(diffStats(diffLines("x\ny", ""))).toEqual({ added: 0, removed: 2 });
  });

  it("finds the LCS rather than replacing the whole block", () => {
    const out = diffLines("1\n2\n3\n4", "1\n3\n4\n5");
    expect(diffStats(out)).toEqual({ added: 1, removed: 1 });
  });

  it("is identity for equal text", () => {
    expect(diffStats(diffLines("same\ntext", "same\ntext"))).toEqual({ added: 0, removed: 0 });
  });
});

describe("withContext", () => {
  it("folds long unchanged runs into a hunk marker", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const neu = old.replace("l10", "L10");
    const out = withContext(diffLines(old, neu), 2);
    expect(out[0].kind).toBe("hunk");
    expect(out.filter((l) => l.kind === "ctx")).toHaveLength(4);
    expect(out[out.length - 1].kind).toBe("hunk");
  });
});

describe("parseUnifiedDiff", () => {
  const patch = [
    "diff --git a/src/app.py b/src/app.py",
    "--- a/src/app.py",
    "+++ b/src/app.py",
    "@@ -1,3 +1,3 @@",
    " keep",
    "-old",
    "+new",
  ].join("\n");

  it("classifies each line by prefix", () => {
    const kinds = parseUnifiedDiff(patch).map((l) => l.kind);
    expect(kinds).toEqual(["meta", "meta", "meta", "hunk", "ctx", "del", "add"]);
  });

  it("reads the target path", () => {
    expect(unifiedDiffPath(patch)).toBe("src/app.py");
    expect(unifiedDiffPath("+x\n-y")).toBeNull();
  });
});

describe("tool input helpers", () => {
  it("parses JSON and Claude Code repr wrappers", () => {
    expect(parseToolInput('{"command":"ls"}')).toEqual({ command: "ls" });
    expect(parseToolInput(`{'raw': '{"command":"ls"}'}`)).toEqual({ command: "ls" });
    expect(parseToolInput("not json")).toBeNull();
  });

  it("summarises by the most telling field", () => {
    expect(toolSummary('{"command":"pytest -q","description":"run"}')).toBe("pytest -q");
    expect(toolSummary('{"file_path":"/a/b.ts"}')).toBe("/a/b.ts");
  });

  it("extracts Edit and MultiEdit changes", () => {
    expect(
      extractEditChanges("Edit", JSON.stringify({ file_path: "/x.ts", old_string: "a", new_string: "b" })),
    ).toEqual([{ path: "/x.ts", oldText: "a", newText: "b" }]);
    const multi = JSON.stringify({
      file_path: "/y.ts",
      edits: [
        { old_string: "1", new_string: "2" },
        { old_string: "3", new_string: "4" },
      ],
    });
    expect(extractEditChanges("MultiEdit", multi)).toHaveLength(2);
    expect(extractEditChanges("Write", JSON.stringify({ file_path: "/z", content: "c" }))).toEqual([]);
  });

  it("infers status from output", () => {
    expect(inferToolStatus(undefined)).toBe("done");
    expect(inferToolStatus("ok\n")).toBe("done");
    expect(inferToolStatus("Error: file not found")).toBe("error");
    expect(inferToolStatus("<tool_use_error>boom</tool_use_error>")).toBe("error");
    expect(inferToolStatus("Permission denied by user")).toBe("denied");
  });

  it("truncates long payloads by line", () => {
    const t = Array.from({ length: 10 }, (_, i) => String(i)).join("\n");
    expect(truncateLines(t, 4)).toEqual({ shown: "0\n1\n2\n3", hidden: 6 });
    expect(truncateLines("a\nb", 4).hidden).toBe(0);
  });
});

describe("classifyError", () => {
  it.each([
    ["401 Unauthorized", "auth"],
    ["Rate limit exceeded (429)", "usage_limit"],
    ["turn exceeded 1200s budget", "timeout"],
    ["claude: command not found", "start_failed"],
    ["TypeError: Failed to fetch", "network"],
    ["weird failure", "generic"],
  ])("%s → %s", (msg, kind) => {
    expect(classifyError(msg).kind).toBe(kind);
  });
});

describe("path references", () => {
  it("splits line refs", () => {
    expect(splitLineRef("src/a.ts:12")).toEqual({ path: "src/a.ts", line: 12, endLine: undefined });
    expect(splitLineRef("src/a.ts:12-20")).toEqual({ path: "src/a.ts", line: 12, endLine: 20 });
    expect(splitLineRef("src/a.ts#L5")).toEqual({ path: "src/a.ts", line: 5, endLine: undefined });
    expect(splitLineRef("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  it("accepts paths, rejects prose and versions", () => {
    expect(isPathCandidate("src/app.py")).toBe(true);
    expect(isPathCandidate("README.md")).toBe(true);
    expect(isPathCandidate("/etc/hosts.conf:3")).toBe(true);
    expect(isPathCandidate("and/or")).toBe(false);
    expect(isPathCandidate("1.2.3")).toBe(false);
    expect(isPathCandidate("https://x.com/a.js")).toBe(false);
    expect(isPathCandidate("npm run build")).toBe(false);
  });
});

describe("markdown tools", () => {
  const rows = [
    ["name", "note"],
    ["a", 'has "quote", comma'],
  ];

  it("serialises tables to CSV", () => {
    expect(rowsToCsv(rows)).toBe('name,note\na,"has ""quote"", comma"');
  });

  it("serialises tables to markdown", () => {
    expect(rowsToMarkdown([["h|1", "h2"], ["x"]])).toBe("| h\\|1 | h2 |\n| --- | --- |\n| x |  |");
  });

  it("detects an unterminated fence", () => {
    expect(openFence("text\n```py\nx=1\n```\n")).toBeNull();
    expect(openFence("text\n```mermaid\ngraph TD")?.lang).toBe("mermaid");
  });

  it("holds back an open mermaid fence only", () => {
    expect(holdOpenMermaid("intro\n```mermaid\ngraph TD\nA-->B")).toEqual({ text: "intro\n", pendingDiagram: true });
    expect(holdOpenMermaid("```py\nx").pendingDiagram).toBe(false);
    const done = "```mermaid\ngraph TD\n```\n";
    expect(holdOpenMermaid(done)).toEqual({ text: done, pendingDiagram: false });
  });
});
