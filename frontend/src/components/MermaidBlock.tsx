import { useEffect, useId, useRef, useState } from "react";

let initialized = false;

async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
    initialized = true;
  }
  const { svg } = await mermaid.render(id, code);
  return svg;
}

interface Props {
  code: string;
}

export default function MermaidBlock({ code }: Props) {
  const uid = useId().replace(/:/g, "");
  const id = `mermaid-${uid}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const rendered = useRef(false);

  useEffect(() => {
    if (rendered.current) return;
    rendered.current = true;
    renderMermaid(id, code.trim())
      .then(setSvg)
      .catch(() => setError(true));
  }, [code, id]);

  if (error) {
    return (
      <code className="block bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre my-2">
        {code}
      </code>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 text-[var(--muted)] text-[13px] py-2">
        <span className="animate-pulse">Rendering diagram…</span>
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-x-auto rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
