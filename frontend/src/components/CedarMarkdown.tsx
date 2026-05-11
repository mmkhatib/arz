// Cedar-themed Markdown renderer.
// react-markdown + remark-gfm for tables, task lists, autolinks, strikethrough.
// rehype-highlight for syntax-coloured code blocks (highlight.js theme baked
// into index.css below this component when needed).
//
// Used by chat messages, channel feeds, project briefs — anywhere we want
// the LLM's markdown to render properly with checklist toggles, code
// blocks, links, etc.

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/atom-one-dark.css";

// remark plugin: split text nodes on @mentions of known names and
// replace each match with a synthetic `link` node carrying an
// `#arz-mention:<name>` href. The `a` component override below
// recognizes that scheme and renders a cedar-glow pill.
function remarkMentions(mentions: string[]) {
  // Build the regex once. Longest first so "coder-2" wins over "coder".
  const ordered = [...new Set(mentions)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return () => {};
  const pattern = new RegExp(
    `(?<![\\w-])@(${ordered.map((m) => m.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})(?![\\w-])`,
    "g",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visit = (node: any) => {
      if (!node || !node.children) return;
      const out: unknown[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          out.push(child);
          continue;
        }
        const v: string = child.value;
        let lastIdx = 0;
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        let pushed = false;
        while ((match = pattern.exec(v)) !== null) {
          pushed = true;
          if (match.index > lastIdx) {
            out.push({ type: "text", value: v.slice(lastIdx, match.index) });
          }
          const name = match[1];
          out.push({
            type: "link",
            url: `#arz-mention:${name}`,
            children: [{ type: "text", value: `@${name}` }],
          });
          lastIdx = match.index + match[0].length;
        }
        if (!pushed) {
          out.push(child);
        } else if (lastIdx < v.length) {
          out.push({ type: "text", value: v.slice(lastIdx) });
        }
      }
      node.children = out;
      for (const c of out as { type: string; children?: unknown }[]) {
        if (c.children) visit(c);
      }
    };
    visit(tree);
  };
}

export function CedarMarkdown({
  text,
  onTaskToggle,
  mentions,
}: {
  text: string;
  onTaskToggle?: (lineIdx: number, checked: boolean) => void;
  /** Member agent names whose @mentions should be highlighted inline. */
  mentions?: string[];
}) {
  const components = useMemo(
    () => ({
      code({ className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) {
        const inline = !className;
        if (inline) {
          return (
            <code
              style={{
                fontFamily: "var(--fm)",
                fontSize: "0.88em",
                background: "var(--s3)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                padding: "0.05em 0.35em",
                color: "var(--cedar-glow)",
              }}
              {...props}
            >
              {children}
            </code>
          );
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      pre({ children }: { children?: React.ReactNode }) {
        return (
          <pre
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 14px",
              overflowX: "auto",
              fontFamily: "var(--fm)",
              fontSize: 12,
              lineHeight: 1.6,
              margin: "8px 0",
            }}
          >
            {children}
          </pre>
        );
      },
      a({ href, children }: { href?: string; children?: React.ReactNode }) {
        if (href && href.startsWith("#arz-mention:")) {
          return (
            <span
              style={{
                display: "inline-block",
                padding: "0 6px",
                borderRadius: 6,
                background: "var(--cedar-dim)",
                border: "1px solid var(--cedar-line)",
                color: "var(--cedar-glow)",
                fontWeight: 500,
                fontFamily: "var(--fm)",
                fontSize: "0.95em",
              }}
              title={href.slice("#arz-mention:".length)}
            >
              {children}
            </span>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--cedar-glow)", textDecoration: "underline" }}
          >
            {children}
          </a>
        );
      },
      ul({ children, className }: { children?: React.ReactNode; className?: string }) {
        const isTaskList = className?.includes("contains-task-list");
        return (
          <ul
            style={{
              paddingLeft: isTaskList ? 0 : "1.4em",
              margin: "6px 0",
              listStyle: isTaskList ? "none" : "disc",
            }}
          >
            {children}
          </ul>
        );
      },
      ol({ children }: { children?: React.ReactNode }) {
        return <ol style={{ paddingLeft: "1.4em", margin: "6px 0" }}>{children}</ol>;
      },
      li({ children, className, ...rest }: { children?: React.ReactNode; className?: string }) {
        const isTask = className?.includes("task-list-item");
        return (
          <li
            className={className}
            style={{
              margin: "3px 0",
              lineHeight: 1.6,
              listStyle: isTask ? "none" : undefined,
              display: isTask ? "flex" : undefined,
              alignItems: isTask ? "flex-start" : undefined,
              gap: isTask ? 8 : undefined,
            }}
            {...rest}
          >
            {children}
          </li>
        );
      },
      input({ checked, type, ...rest }: { checked?: boolean; type?: string }) {
        if (type !== "checkbox") return <input type={type} {...rest} />;
        return (
          <input
            type="checkbox"
            checked={!!checked}
            readOnly={!onTaskToggle}
            onChange={(e) => onTaskToggle?.(0, e.target.checked)}
            style={{
              accentColor: "var(--cedar)",
              marginTop: 5,
              cursor: onTaskToggle ? "pointer" : "default",
            }}
          />
        );
      },
      h1: (p: { children?: React.ReactNode }) => (
        <h1 style={{ fontFamily: "var(--fd)", fontSize: 22, margin: "12px 0 8px", color: "var(--text)" }}>{p.children}</h1>
      ),
      h2: (p: { children?: React.ReactNode }) => (
        <h2 style={{ fontFamily: "var(--fd)", fontSize: 18, margin: "10px 0 6px", color: "var(--text)" }}>{p.children}</h2>
      ),
      h3: (p: { children?: React.ReactNode }) => (
        <h3 style={{ fontSize: 14.5, fontWeight: 600, margin: "8px 0 4px", color: "var(--text)" }}>{p.children}</h3>
      ),
      p: (p: { children?: React.ReactNode }) => (
        <p style={{ margin: "6px 0", lineHeight: 1.6, color: "var(--text)" }}>{p.children}</p>
      ),
      blockquote: (p: { children?: React.ReactNode }) => (
        <blockquote
          style={{
            margin: "8px 0",
            padding: "6px 12px",
            borderLeft: "3px solid var(--cedar-line)",
            background: "var(--cedar-dim)",
            color: "var(--text2)",
          }}
        >
          {p.children}
        </blockquote>
      ),
      table: (p: { children?: React.ReactNode }) => (
        <div style={{ overflowX: "auto", margin: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>{p.children}</table>
        </div>
      ),
      th: (p: { children?: React.ReactNode }) => (
        <th
          style={{
            border: "1px solid var(--border)",
            padding: "6px 10px",
            textAlign: "left",
            background: "var(--s2)",
            color: "var(--text)",
          }}
        >
          {p.children}
        </th>
      ),
      td: (p: { children?: React.ReactNode }) => (
        <td style={{ border: "1px solid var(--border)", padding: "6px 10px", color: "var(--text)" }}>
          {p.children}
        </td>
      ),
    }),
    [onTaskToggle],
  );

  return (
    <div
      style={{
        fontFamily: "var(--fn)",
        fontSize: 13.5,
        lineHeight: 1.6,
        color: "var(--text)",
        wordBreak: "break-word",
      }}
    >
      <ReactMarkdown
        remarkPlugins={
          mentions && mentions.length > 0
            ? [remarkGfm, remarkMentions(mentions)]
            : [remarkGfm]
        }
        rehypePlugins={[rehypeHighlight]}
        components={components as never}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
