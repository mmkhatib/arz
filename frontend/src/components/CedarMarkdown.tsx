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

// Copy HAST `position` onto a `data-sourcepos="L:C-L:C"` HTML attribute
// so a DOM Range can be mapped back to a source line/column. Gated by
// the `sourcePos` prop — only used by the inline-comment file viewer
// pathway; chat / channel renders don't need the extra attribute spam.
function rehypeSourcepos() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any) => {
      if (node && node.type === "element" && node.position && node.position.start) {
        const s = node.position.start;
        const e = node.position.end || s;
        node.properties = node.properties || {};
        node.properties["data-sourcepos"] = `${s.line}:${s.column}-${e.line}:${e.column}`;
      }
      if (node && node.children) for (const c of node.children) walk(c);
    };
    walk(tree);
  };
}

// Pluck the data-sourcepos attribute out of an override's props so we
// can spread it onto the rendered element without listing every other
// HTMLAttribute by hand.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sp = (p: any) => {
  const v = p && p["data-sourcepos"];
  return v ? { "data-sourcepos": v } : {};
};

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
      // Skip our own synthetic mention links — otherwise we'd match
      // their inner "@name" text again and recurse forever.
      if (
        node.type === "link" &&
        typeof node.url === "string" &&
        node.url.startsWith("#arz-mention:")
      ) {
        return;
      }
      // Don't dive into code blocks / inline code — @mentions inside
      // code spans should stay literal.
      if (node.type === "code" || node.type === "inlineCode") {
        return;
      }
      const out: unknown[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
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
      // Recurse only into non-mention children that actually have
      // their own children — text nodes terminate; our synthetic
      // mention links are skipped at the top of visit().
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
  sourcePos,
}: {
  text: string;
  onTaskToggle?: (lineIdx: number, checked: boolean) => void;
  /** Member agent names whose @mentions should be highlighted inline. */
  mentions?: string[];
  /** When true, attach a rehype plugin that copies HAST positions onto a
   *  `data-sourcepos` attribute on every element. Required by the
   *  FileViewer inline-comment pathway so a DOM selection can map back
   *  to a source line/column. Off by default — adds attribute spam to
   *  every chat render otherwise. */
  sourcePos?: boolean;
}) {
  const components = useMemo(
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      code({ className, children, ...props }: any) {
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
              {...sp(props)}
            >
              {children}
            </code>
          );
        }
        return (
          <code className={className} {...sp(props)}>
            {children}
          </code>
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pre({ children, ...props }: any) {
        return (
          <pre
            {...sp(props)}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ul({ children, className, ...rest }: any) {
        const isTaskList = className?.includes("contains-task-list");
        return (
          <ul
            {...sp(rest)}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ol({ children, ...rest }: any) {
        return (
          <ol {...sp(rest)} style={{ paddingLeft: "1.4em", margin: "6px 0" }}>
            {children}
          </ol>
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      li({ children, className, ...rest }: any) {
        const isTask = className?.includes("task-list-item");
        return (
          <li
            {...sp(rest)}
            className={className}
            style={{
              margin: "3px 0",
              lineHeight: 1.6,
              listStyle: isTask ? "none" : undefined,
              display: isTask ? "flex" : undefined,
              alignItems: isTask ? "flex-start" : undefined,
              gap: isTask ? 8 : undefined,
            }}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h1: (p: any) => (
        <h1 {...sp(p)} style={{ fontFamily: "var(--fd)", fontSize: 22, margin: "12px 0 8px", color: "var(--text)" }}>{p.children}</h1>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h2: (p: any) => (
        <h2 {...sp(p)} style={{ fontFamily: "var(--fd)", fontSize: 18, margin: "10px 0 6px", color: "var(--text)" }}>{p.children}</h2>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h3: (p: any) => (
        <h3 {...sp(p)} style={{ fontSize: 14.5, fontWeight: 600, margin: "8px 0 4px", color: "var(--text)" }}>{p.children}</h3>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p: (p: any) => (
        <p {...sp(p)} style={{ margin: "6px 0", lineHeight: 1.6, color: "var(--text)" }}>{p.children}</p>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockquote: (p: any) => (
        <blockquote
          {...sp(p)}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table: (p: any) => (
        <div style={{ overflowX: "auto", margin: "8px 0" }}>
          <table {...sp(p)} style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>{p.children}</table>
        </div>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      th: (p: any) => (
        <th
          {...sp(p)}
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      td: (p: any) => (
        <td {...sp(p)} style={{ border: "1px solid var(--border)", padding: "6px 10px", color: "var(--text)" }}>
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
        rehypePlugins={sourcePos ? [rehypeHighlight, rehypeSourcepos] : [rehypeHighlight]}
        components={components as never}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
