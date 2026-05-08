/**
 * FileViewer — full-height file viewer with syntax highlighting and type-aware rendering.
 * Ports the MeshClaw FileRenderers + MarkdownPanel approach into Arz's design system.
 */
import { memo, useState, useEffect, useRef, useMemo } from 'react'
import { X, Copy, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { api } from '@/api/client'
import { highlight, langForPath } from '@/utils/hljs'

/* ── File type detection ── */
type FileType = 'image' | 'csv' | 'json' | 'html' | 'markdown' | 'code' | 'binary'

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'])
const CSV_EXTS = new Set(['csv', 'tsv'])
const BINARY_EXTS = new Set(['pdf', 'wasm', 'zip', 'tar', 'gz', '7z', 'exe', 'bin', 'dylib', 'so', 'pyc', 'class', 'mp3', 'mp4', 'mov', 'avi', 'ttf', 'otf', 'woff', 'woff2'])
const MD_EXTS = new Set(['md', 'markdown', 'mdx'])

function detectType(path: string): FileType {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (IMG_EXTS.has(ext)) return 'image'
  if (CSV_EXTS.has(ext)) return 'csv'
  if (ext === 'json' || ext === 'jsonl') return 'json'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'code'
}

/* ── Syntax-highlighted code view ── */
function CodeView({ content, lang }: { content: string; lang: string }) {
  const html = useMemo(() => highlight(content, lang), [content, lang])
  const lines = content.split('\n')
  const scrollRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const syncScroll = () => {
    if (scrollRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }

  return (
    <div className="relative flex h-full font-mono text-[12px] leading-[1.6] bg-[var(--bg)] overflow-hidden">
      {/* Line numbers */}
      <div
        ref={gutterRef}
        className="shrink-0 w-[3em] bg-[var(--surface)] border-r border-[var(--border)] text-right pr-2 pt-3 text-[11px] text-[var(--muted)]/40 select-none overflow-hidden"
      >
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      {/* Highlighted code */}
      <pre
        ref={scrollRef}
        className="flex-1 p-3 overflow-auto whitespace-pre hljs"
        onScroll={syncScroll}
        dangerouslySetInnerHTML={{ __html: html + '\n' }}
      />
    </div>
  )
}

/* ── JSON tree viewer (ported from MeshClaw) ── */
function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  if (value === null) return <span className="text-[var(--muted)]">null</span>
  if (typeof value === 'boolean') return <span className="text-green-400">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-[var(--cedar)]">{value}</span>
  if (typeof value === 'string') {
    const display = value.length > 200 ? value.slice(0, 200) + '…' : value
    return <span className="text-amber-400">"{display}"</span>
  }
  const isArr = Array.isArray(value)
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [i, v] as const)
    : Object.entries(value as Record<string, unknown>)
  const [open_b, close_b] = isArr ? ['[', ']'] : ['{', '}']

  return (
    <span>
      <button
        className="text-[var(--muted)] hover:text-[var(--text)] cursor-pointer bg-transparent border-none font-mono text-[12px]"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={11} className="inline" /> : <ChevronRight size={11} className="inline" />}
        {' '}{open_b}{!open && <span className="text-[var(--muted)]"> {entries.length} {close_b}</span>}
      </button>
      {open && (
        <div style={{ paddingLeft: 16 }}>
          {entries.slice(0, 200).map(([k, v]) => (
            <div key={String(k)}>
              {!isArr && <span className="text-blue-400">"{String(k)}"</span>}
              {!isArr && <span className="text-[var(--muted)]">: </span>}
              <JsonNode value={v} depth={depth + 1} />
            </div>
          ))}
          {entries.length > 200 && <div className="text-[var(--muted)]">… {entries.length - 200} more</div>}
        </div>
      )}
      {open && <span className="text-[var(--muted)]">{close_b}</span>}
    </span>
  )
}

function JsonView({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try { return { ok: true as const, value: JSON.parse(content) } }
    catch { return { ok: false as const } }
  }, [content])

  if (!parsed.ok) {
    // Fall back to syntax-highlighted raw view
    return <CodeView content={content} lang="json" />
  }
  return (
    <div className="h-full overflow-auto p-3 font-mono text-[12px] leading-[1.6] bg-[var(--bg)]">
      <JsonNode value={parsed.value} depth={0} />
    </div>
  )
}

/* ── CSV table viewer ── */
function CsvView({ content, path }: { content: string; path: string }) {
  const delimiter = path.endsWith('.tsv') ? '\t' : ','
  const rows = useMemo(() => {
    return content.split('\n').filter(l => l.trim()).map(line => {
      const cells: string[] = []
      let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue } inQ = !inQ; continue }
        if (ch === delimiter && !inQ) { cells.push(cur); cur = ''; continue }
        cur += ch
      }
      cells.push(cur)
      return cells
    })
  }, [content, delimiter])

  if (rows.length === 0) return <div className="p-4 text-[var(--muted)] text-sm">Empty file</div>
  const [header, ...body] = rows

  return (
    <div className="h-full overflow-auto bg-[var(--bg)]">
      <table className="w-full text-[12px] font-mono border-collapse">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr>{header.map((h, i) => <th key={i} className="px-3 py-2 text-left text-[11px] font-semibold text-[var(--muted)] border-b border-[var(--border)] whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.slice(0, 500).map((row, ri) => (
            <tr key={ri} className="hover:bg-[var(--surface)]">
              {row.map((cell, ci) => <td key={ci} className="px-3 py-1.5 text-[var(--text)] border-b border-[var(--border)]/40 whitespace-nowrap">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > 500 && <div className="text-center text-[var(--muted)] text-[11px] py-2">Showing 500 of {body.length} rows</div>}
    </div>
  )
}

/* ── HTML sandboxed viewer ── */
function HtmlView({ content }: { content: string }) {
  return (
    <div className="h-full border border-[var(--border)] overflow-hidden bg-white">
      <iframe srcDoc={content} sandbox="" className="w-full h-full border-none" title="HTML Preview" />
    </div>
  )
}

/* ── Markdown viewer with live comment-driven editing ── */
//
// Two view modes (Rendered / Raw). In Rendered mode, drag-select any
// span of text to attach a comment. Comments queue in the right-edge
// rail; Send All hands the file + comments to a subagent that edits
// in place. The viewer auto-refreshes every 3s while open so you can
// watch the file change live.

interface PendingComment {
  id: number
  selection: string
  comment: string
}

function MarkdownView({
  content,
  path,
  sessionId,
  onSent,
}: {
  content: string
  path: string
  sessionId?: string | null
  onSent?: () => void
}) {
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered')
  const [draftSelection, setDraftSelection] = useState<string>('')
  const [draftText, setDraftText] = useState<string>('')
  const [comments, setComments] = useState<PendingComment[]>([])
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState<string | null>(null)
  const nextId = useRef(1)
  const renderedRef = useRef<HTMLDivElement>(null)

  // Capture mouseup over the rendered area; if there's a non-empty
  // selection inside it, open the comment composer.
  const handleSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !renderedRef.current) return
    const text = sel.toString().trim()
    if (!text) return
    // Make sure the selection is INSIDE the rendered area, not in the
    // comment rail or anywhere else.
    const node = sel.anchorNode
    if (!node || !renderedRef.current.contains(node)) return
    setDraftSelection(text)
    setDraftText('')
  }

  const cancelDraft = () => {
    setDraftSelection('')
    setDraftText('')
  }

  const addComment = () => {
    const t = draftText.trim()
    if (!t) return
    setComments((prev) => [
      ...prev,
      { id: nextId.current++, selection: draftSelection, comment: t },
    ])
    cancelDraft()
  }

  const removeComment = (id: number) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  const sendAll = async () => {
    if (!sessionId || comments.length === 0) return
    setSending(true)
    setSendErr(null)
    try {
      await api.editFileWithComments({
        path,
        comments: comments.map((c) => ({ selection: c.selection, comment: c.comment })),
        session_id: sessionId,
      })
      setComments([])
      onSent?.()
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const railOpen = comments.length > 0 || !!draftSelection

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mode toggle */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface)]/60">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <button
              onClick={() => setMode('rendered')}
              className={[
                'px-2 py-0.5 rounded',
                mode === 'rendered'
                  ? 'bg-[var(--cedar)]/15 text-[var(--text)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Rendered
            </button>
            <button
              onClick={() => setMode('raw')}
              className={[
                'px-2 py-0.5 rounded',
                mode === 'raw'
                  ? 'bg-[var(--cedar)]/15 text-[var(--text)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Raw
            </button>
          </div>
          {sessionId && mode === 'rendered' && (
            <span className="text-[10px] text-[var(--muted)]/60">
              Highlight any text to leave a comment
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto" onMouseUp={mode === 'rendered' ? handleSelection : undefined}>
          {mode === 'rendered' ? (
            <div
              ref={renderedRef}
              className="p-4 prose prose-sm prose-invert max-w-none text-[var(--text)] text-[13px] leading-relaxed"
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <pre className="p-4 text-[12px] font-mono text-[var(--text)] whitespace-pre-wrap break-words">
              {content}
            </pre>
          )}
        </div>
      </div>

      {/* Comment rail */}
      {sessionId && railOpen && (
        <div className="w-72 shrink-0 flex flex-col border-l border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]">
            <span className="text-[11px] font-semibold text-[var(--text)]">Comments</span>
            <span className="text-[10px] text-[var(--muted)] font-mono">{comments.length}</span>
          </div>

          {/* Draft composer */}
          {draftSelection && (
            <div className="border-b border-[var(--border)] p-3 flex flex-col gap-2 bg-[var(--bg)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">On selection</div>
              <pre className="text-[11px] font-mono text-[var(--muted)] bg-[var(--surface)] rounded p-2 whitespace-pre-wrap max-h-[80px] overflow-y-auto border border-[var(--border)]">
                {draftSelection.length > 200 ? draftSelection.slice(0, 200) + '…' : draftSelection}
              </pre>
              <textarea
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment()
                  else if (e.key === 'Escape') cancelDraft()
                }}
                rows={3}
                placeholder="What should arz do here? (Cmd+Enter to add)"
                className="bg-[var(--surface)] border border-[var(--border)] rounded p-2 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
              />
              <div className="flex justify-end gap-2 text-[11px]">
                <button onClick={cancelDraft} className="text-[var(--muted)] hover:text-[var(--text)] px-2 py-0.5">
                  Cancel
                </button>
                <button
                  onClick={addComment}
                  disabled={!draftText.trim()}
                  className="px-2 py-0.5 rounded bg-[var(--cedar)] text-white disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Queue */}
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {comments.length === 0 && !draftSelection && (
              <div className="text-[11px] text-[var(--muted)]/60 italic text-center py-8">
                Highlight text in the document to leave a comment.
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="border border-[var(--border)] rounded p-2 bg-[var(--bg)]">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <pre className="flex-1 text-[10px] font-mono text-[var(--muted)] whitespace-pre-wrap max-h-[60px] overflow-hidden break-words">
                    {c.selection.length > 80 ? c.selection.slice(0, 80) + '…' : c.selection}
                  </pre>
                  <button
                    onClick={() => removeComment(c.id)}
                    className="text-[var(--muted)] hover:text-red-400 shrink-0"
                  >
                    <X size={11} />
                  </button>
                </div>
                <div className="text-[12px] text-[var(--text)]">{c.comment}</div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--border)] p-2 flex flex-col gap-1.5">
            {sendErr && <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{sendErr}</div>}
            <button
              onClick={sendAll}
              disabled={comments.length === 0 || sending}
              className="px-3 py-1.5 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)] flex items-center justify-center gap-1"
            >
              {sending ? 'Sending…' : `Send all (${comments.length})`}
            </button>
            <span className="text-[10px] text-[var(--muted)]/60 text-center">
              File auto-refreshes — watch edits land live.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main FileViewer ── */
interface Props {
  path: string
  onClose: () => void
  /** Active session id — needed to fire the comment-driven editor for
   *  markdown files. When absent, the comment rail is hidden. */
  sessionId?: string | null
}

export const FileViewer = memo(function FileViewer({ path, onClose, sessionId }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const name = path.split('/').pop() || path
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const type = detectType(path)
  const lang = langForPath(path)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await api.readFile(path)
      setContent(r.content)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to read file')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (type === 'binary' || type === 'image') { setLoading(false); return }
    load()
  }, [path])

  // Live refresh: while a markdown file is open, poll every 3s so
  // comment-driven edits show up without the user clicking refresh.
  useEffect(() => {
    if (type !== 'markdown') return
    const id = window.setInterval(() => {
      if (document.hidden) return
      api
        .readFile(path)
        .then((r) => setContent((cur) => (cur === r.content ? cur : r.content)))
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(id)
  }, [path, type])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const copy = async () => {
    if (!content) return
    try { await navigator.clipboard.writeText(content) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0 bg-[var(--surface)]">
        <span className="flex-1 text-[12px] font-medium text-[var(--text)] truncate" title={path}>{name}</span>
        {ext && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--border)] text-[var(--muted)] uppercase shrink-0">{ext}</span>
        )}
        {content && (
          <button
            onClick={copy}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] shrink-0 transition-colors"
          >
            {copied ? 'Copied!' : <Copy size={11} />}
          </button>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshing || type === 'binary' || type === 'image'}
          className="text-[var(--muted)] hover:text-[var(--text)] shrink-0 disabled:opacity-30 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] shrink-0 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Sub-header: full path */}
      <div className="px-3 py-1 border-b border-[var(--border)] shrink-0">
        <span className="text-[10px] text-[var(--muted)]/50 font-mono truncate block" title={path}>{path}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full text-[var(--muted)]/40 text-[13px]">
            Loading…
          </div>
        )}
        {!loading && error && (
          <div className="p-4 text-red-400 text-[12px]">{error}</div>
        )}
        {!loading && !error && type === 'binary' && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2">
            <span className="text-3xl">📦</span>
            <span className="text-[13px]">Binary file — cannot preview</span>
            <span className="text-[11px] font-mono">.{ext}</span>
          </div>
        )}
        {!loading && !error && type === 'image' && (
          <div className="flex items-center justify-center h-full p-4 bg-[var(--surface)]">
            <img
              src={`/api/files/read?path=${encodeURIComponent(path)}`}
              alt={name}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}
        {!loading && !error && content !== null && type === 'json' && <JsonView content={content} />}
        {!loading && !error && content !== null && type === 'csv' && <CsvView content={content} path={path} />}
        {!loading && !error && content !== null && type === 'html' && <HtmlView content={content} />}
        {!loading && !error && content !== null && type === 'markdown' && (
          <MarkdownView
            content={content}
            path={path}
            sessionId={sessionId ?? null}
            onSent={() => { void load() }}
          />
        )}
        {!loading && !error && content !== null && type === 'code' && <CodeView content={content} lang={lang} />}
      </div>
    </div>
  )
})
