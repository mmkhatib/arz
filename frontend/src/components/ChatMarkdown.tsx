import { memo, useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Workflow } from "lucide-react";
import CodeBlock, { codeText } from "./CodeBlock";
import CopyButton from "./CopyButton";
import { ChatImage } from "./Lightbox";
import { formatPathRef, isPathCandidate, splitLineRef } from "@/utils/pathRefs";
import { holdOpenMermaid, rowsToCsv, rowsToMarkdown } from "@/utils/markdownTools";

/* Path-shaped tokens we want to make click-to-open. Catches:
 *   /abs/posix/path.ext
 *   ./rel/path.ext  ../rel/path.ext  rel/path.ext  rel\\path.ext
 *   C:\\Users\\foo\\bar.ext   C:/Users/foo/bar.ext
 * with an optional trailing `:12` / `:12-20` line reference.
 * Bare filenames must have a known-ish extension to qualify (≤8 chars,
 * alphanumeric) so we don't wrap "etc." or "fig.4".
 */
const _PATH_RE =
  /(?<![\w/\\-])((?:[A-Za-z]:[\\/][^\s"'`<>()[\]{}|]+\.[A-Za-z0-9]{1,8})|(?:\.{1,2}[\\/][^\s"'`<>()[\]{}|]+\.[A-Za-z0-9]{1,8})|(?:\/[\w.\-_~][\w.\-_~/]*\.[A-Za-z0-9]{1,8})|(?:[\w.\-_~]+[\\/][\w.\-_~][\w.\-_~\\/]*\.[A-Za-z0-9]{1,8}))((?::\d+(?:-\d+)?)?)(?![\w])/g;

/** remark plugin: split text nodes on path-shaped tokens and replace
 *  matches with synthetic link nodes carrying `#arz-file:<path[:line]>`.
 *  The `a` override below intercepts the scheme and renders a themed
 *  click-to-open pill. */
function remarkFilePaths() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visit = (node: any) => {
      if (!node || !node.children) return;
      // Skip code blocks / inline code / links (ours and the author's).
      if (node.type === "code" || node.type === "inlineCode" || node.type === "link") return;
      const out: unknown[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          out.push(child);
          continue;
        }
        const v: string = child.value;
        let last = 0;
        let m: RegExpExecArray | null;
        _PATH_RE.lastIndex = 0;
        let pushed = false;
        while ((m = _PATH_RE.exec(v)) !== null) {
          pushed = true;
          const token = m[1] + (m[2] || "");
          if (m.index > last) out.push({ type: "text", value: v.slice(last, m.index) });
          out.push({
            type: "link",
            url: `#arz-file:${token}`,
            children: [{ type: "text", value: token }],
          });
          last = m.index + m[0].length;
        }
        if (!pushed) out.push(child);
        else if (last < v.length) out.push({ type: "text", value: v.slice(last) });
      }
      node.children = out;
      for (const c of out as { type: string; children?: unknown }[]) {
        if (c.children) visit(c);
      }
    };
    visit(tree);
  };
}

/** rehype plugin: append a caret span after the last text the stream
 *  has produced, so the reader's eye has an anchor at the write head. */
function rehypeStreamingCaret() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = tree;
    // Descend through the last child while it's an element (not pre/code
    // — a caret inside a code block would get copied with the code).
    for (;;) {
      const kids = target.children ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastEl = [...kids].reverse().find((k: any) => k.type === "element" || (k.type === "text" && k.value.trim()));
      if (!lastEl || lastEl.type !== "element") break;
      if (lastEl.tagName === "pre" || lastEl.tagName === "code" || lastEl.tagName === "div") break;
      target = lastEl;
    }
    target.children = [
      ...(target.children ?? []),
      { type: "element", tagName: "span", properties: { className: ["arz-caret"] }, children: [] },
    ];
  };
}

/** Table with a hover toolbar: copy as Markdown or CSV. */
function ChatTable({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLTableElement | null>(null);
  const rows = () =>
    Array.from(ref.current?.rows ?? []).map((r) =>
      Array.from(r.cells).map((c) => (c.textContent ?? "").trim()),
    );
  return (
    <div className="group/table relative my-2">
      <div className="absolute -top-3 right-1 z-10 hidden group-hover/table:flex gap-1 bg-[var(--bg)] rounded px-0.5">
        <CopyButton getText={() => rowsToMarkdown(rows())} label="MD" title="Copy as Markdown table" />
        <CopyButton getText={() => rowsToCsv(rows())} label="CSV" title="Copy as CSV" />
      </div>
      <div className="overflow-x-auto">
        <table ref={ref} className="text-[13px] border-collapse w-full">
          {children}
        </table>
      </div>
    </div>
  );
}

function FilePill({
  token,
  onFileOpen,
  children,
}: {
  token: string;
  onFileOpen?: (path: string) => void;
  children: React.ReactNode;
}) {
  const ref = splitLineRef(token);
  return (
    <span
      onClick={onFileOpen ? () => onFileOpen(formatPathRef(ref)) : undefined}
      title={onFileOpen ? `Open ${formatPathRef(ref)}` : formatPathRef(ref)}
      className={[
        "inline-flex items-center px-1 py-0.5 rounded border text-[12px] font-mono",
        "border-[var(--cedar)]/40 bg-[var(--cedar)]/10 text-[var(--cedar)]",
        onFileOpen ? "cursor-pointer hover:bg-[var(--cedar)]/20 hover:border-[var(--cedar)]" : "",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

interface Props {
  text: string;
  onFileOpen?: (path: string) => void;
  /** Live stream: show a caret at the write head and hold back an
   *  unterminated mermaid fence until it closes. */
  streaming?: boolean;
}

/** The one markdown renderer for the chat transcript — saved bubbles and
 *  the live stream share it so nothing jumps when a turn completes. */
function ChatMarkdown({ text, onFileOpen, streaming = false }: Props) {
  const { body, pendingDiagram } = useMemo(() => {
    if (!streaming) return { body: text, pendingDiagram: false };
    const held = holdOpenMermaid(text);
    return { body: held.text, pendingDiagram: held.pendingDiagram };
  }, [text, streaming]);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath, remarkFilePaths], []);
  const rehypePlugins = useMemo(
    () => (streaming && !pendingDiagram ? [rehypeKatex, rehypeStreamingCaret] : [rehypeKatex]),
    [streaming, pendingDiagram],
  );

  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
      code: ({ children, className }) => {
        const lang = className?.match(/language-([\w+-]+)/)?.[1];
        if (lang !== undefined) {
          return <CodeBlock code={codeText(children)} lang={lang} onOpenFile={onFileOpen} />;
        }
        const t = codeText(children);
        // Untagged fences arrive without a className but contain newlines.
        if (t.includes("\n")) return <CodeBlock code={t} lang="" onOpenFile={onFileOpen} />;
        const isPath = !!onFileOpen && isPathCandidate(t);
        return (
          <code
            className={[
              "bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 text-[12px] font-mono",
              isPath ? "cursor-pointer text-[var(--cedar)] hover:underline hover:border-[var(--cedar)]/50" : "",
            ].join(" ")}
            onClick={isPath ? () => onFileOpen!(t.trim()) : undefined}
            title={isPath ? `Open ${t}` : undefined}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }) => <>{children}</>,
      ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
      li: ({ children }) => <li className="text-[14px]">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-[var(--text)]">{children}</strong>,
      a: ({ href, children }) => {
        if (typeof href === "string" && href.startsWith("#arz-file:")) {
          return (
            <FilePill token={href.slice("#arz-file:".length)} onFileOpen={onFileOpen}>
              {children}
            </FilePill>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--cedar-lt)]"
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => <ChatImage src={typeof src === "string" ? src : undefined} alt={alt} />,
      span: ({ className, children }) =>
        className === "arz-caret" ? (
          <span
            aria-hidden
            className="inline-block w-[7px] h-[1.05em] ml-0.5 align-[-2px] rounded-[1px] bg-[var(--cedar-glow)] animate-pulse"
          />
        ) : (
          <span className={className}>{children}</span>
        ),
      h1: ({ children }) => <h1 className="text-[16px] font-semibold mb-1 mt-2">{children}</h1>,
      h2: ({ children }) => <h2 className="text-[15px] font-semibold mb-1 mt-2">{children}</h2>,
      h3: ({ children }) => <h3 className="text-[14px] font-semibold mb-1 mt-1">{children}</h3>,
      table: ({ children }) => <ChatTable>{children}</ChatTable>,
      th: ({ children }) => (
        <th className="border border-[var(--border)] px-3 py-1.5 bg-[var(--surface)] text-left font-semibold text-[var(--text)]">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-[var(--border)] px-3 py-1.5 text-[var(--text)]">{children}</td>
      ),
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-[var(--cedar)] pl-3 text-[var(--muted)] italic my-2">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="border-[var(--border)] my-3" />,
    }),
    [onFileOpen],
  );

  return (
    <>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {body}
      </ReactMarkdown>
      {pendingDiagram && (
        <div className="my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--cedar-line)] text-[12px] text-[var(--muted)] font-mono">
          <Workflow size={13} className="text-[var(--cedar-glow)] animate-pulse" />
          drawing diagram…
        </div>
      )}
    </>
  );
}

export default memo(ChatMarkdown);
