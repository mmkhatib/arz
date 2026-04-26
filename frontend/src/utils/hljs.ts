import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import markdown from 'highlight.js/lib/languages/markdown'
import ini from 'highlight.js/lib/languages/ini'
import cpp from 'highlight.js/lib/languages/cpp'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('toml', ini)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('cfg', ini)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)

export default hljs

export const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonl: 'json',
  yaml: 'yaml', yml: 'yaml',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css',
  sql: 'sql',
  rs: 'rust',
  java: 'java',
  go: 'go',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  toml: 'toml', ini: 'ini', cfg: 'ini',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'cpp',
  xml: 'xml',
}

export function langForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_LANG[ext] || ''
}

export function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang }).value } catch { /* fallback */ }
  }
  try { return hljs.highlightAuto(code).value } catch { /* fallback */ }
  return escapeHtml(code)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
