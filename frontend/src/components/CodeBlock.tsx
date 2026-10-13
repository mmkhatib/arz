import { useMemo } from "react";
import "highlight.js/styles/atom-one-dark.css";
import { highlight } from "@/utils/hljs";
import CopyButton from "./CopyButton";
import MermaidBlock from "./MermaidBlock";
import { FenceDiffBlock } from "./DiffBlock";

/** Fences whose content is prose — wrap instead of scrolling sideways. */
const PROSE_LANGS = new Set(["md", "markdown", "txt", "text", "plaintext", "prose", ""]);

/** Tall blocks repeat the Copy action at the bottom so it's reachable
 *  without scrolling back up. Measured in source lines (≈ 19px each). */
const BOTTOM_COPY_MIN_LINES = 25;

/** Flatten react-markdown children (string | string[]) to the raw code. */
export function codeText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map((c) => (typeof c === "string" ? c : "")).join("");
  return String(children ?? "");
}

export default function CodeBlock({
  code,
  lang,
  onOpenFile,
}: {
  code: string;
  lang: string;
  onOpenFile?: (path: string) => void;
}) {
  const body = code.replace(/\n$/, "");
  const lineCount = body.split("\n").length;
  const html = useMemo(
    () => (lang === "mermaid" || lang === "diff" || lang === "patch" ? "" : highlight(body, lang)),
    [body, lang],
  );

  if (lang === "mermaid") return <MermaidBlock code={body} />;
  if (lang === "diff" || lang === "patch") return <FenceDiffBlock code={body} onOpenFile={onOpenFile} />;

  const wrap = PROSE_LANGS.has(lang);

  return (
    <div
      style={{
        margin: "8px 0",
        border: "1px solid var(--cedar-line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Header chrome — matches Widget / WrittenFilePreviewCard so
          inline ```fenced``` blocks read as part of the same family
          of renderer cards. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--cedar-dim)",
          borderBottom: "1px solid var(--cedar-line)",
          fontFamily: "var(--fm)",
          fontSize: 10,
          color: "var(--cedar-glow)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
      >
        <span>{lang || "code"}</span>
        {lineCount > 1 && (
          <span style={{ color: "var(--muted)" }}>
            {lineCount} lines
          </span>
        )}
        <span style={{ flex: 1 }} />
        <CopyButton text={body} title="Copy code" />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--fm)",
          fontSize: 12.5,
          lineHeight: 1.55,
          overflowX: "auto",
          whiteSpace: wrap ? "pre-wrap" : "pre",
          wordBreak: wrap ? "break-word" : undefined,
        }}
      >
        <code
          className={`hljs language-${lang || "plaintext"}`}
          style={{ background: "transparent", padding: 0 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
      {lineCount >= BOTTOM_COPY_MIN_LINES && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "4px 10px",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <CopyButton text={body} title="Copy code" />
        </div>
      )}
    </div>
  );
}
