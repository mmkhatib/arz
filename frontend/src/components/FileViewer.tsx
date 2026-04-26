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

/* ── Markdown viewer ── */
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto p-4 prose prose-sm prose-invert max-w-none text-[var(--text)] text-[13px] leading-relaxed">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}

/* ── Main FileViewer ── */
interface Props {
  path: string
  onClose: () => void
}

export const FileViewer = memo(function FileViewer({ path, onClose }: Props) {
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
        {!loading && !error && content !== null && type === 'markdown' && <MarkdownView content={content} />}
        {!loading && !error && content !== null && type === 'code' && <CodeView content={content} lang={lang} />}
      </div>
    </div>
  )
})
