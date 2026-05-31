// Table-of-contents sidebar for the markdown view.
//
// Watches the rendered surface for heading mutations (re-renders during
// live-reload, streaming content, etc.) and rebuilds a flat list of
// {level, text, id} entries. Clicking an entry scrolls the surface to
// the matching heading. Uses MutationObserver so the TOC stays in sync
// without us having to know when the parent re-rendered.

import { useEffect, useState } from "react";

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function collectHeadings(root: HTMLElement): TocEntry[] {
  const out: TocEntry[] = [];
  const nodes = root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6");
  const counts = new Map<string, number>();
  nodes.forEach((h) => {
    const level = parseInt(h.tagName.slice(1), 10);
    const text = (h.textContent || "").trim();
    if (!text) return;
    let id = h.id || slugify(text);
    // Disambiguate duplicate headings.
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    if (!h.id) h.id = id;
    out.push({ level, text, id });
  });
  return out;
}

export function MarkdownToc({
  surfaceRef,
  scrollRoot,
}: {
  surfaceRef: React.RefObject<HTMLElement | null>;
  /** The scrollable container whose scrollTop we'll move on click.
   *  Falls back to the surfaceRef element if not provided. */
  scrollRoot?: React.RefObject<HTMLElement | null>;
}) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    setEntries(collectHeadings(el));
    const obs = new MutationObserver(() => setEntries(collectHeadings(el)));
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [surfaceRef]);

  // Highlight the entry whose heading is closest to the scroll top.
  useEffect(() => {
    const scroller = scrollRoot?.current ?? surfaceRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const headings = surface.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
      const scrollerTop = scroller.getBoundingClientRect().top;
      let best: HTMLElement | null = null;
      headings.forEach((h) => {
        const top = h.getBoundingClientRect().top - scrollerTop;
        if (top <= 24) best = h; // 24px tolerance for headers above the fold
      });
      setActiveId(best ? (best as HTMLElement).id : null);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollRoot, surfaceRef, entries]);

  const onClick = (id: string) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const target = surface.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (!target) return;
    const scroller = scrollRoot?.current ?? surface;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scroller.scrollBy({ top: targetRect.top - scrollerRect.top - 12, behavior: "smooth" });
  };

  if (entries.length === 0) return null;

  return (
    <div
      className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto py-2"
      style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
    >
      <div className="px-3 pb-1.5 text-[9.5px] uppercase tracking-[.12em] text-[var(--muted)]">
        Contents
      </div>
      <div className="flex flex-col">
        {entries.map((e) => (
          <button
            key={e.id}
            onClick={() => onClick(e.id)}
            className={[
              "text-left text-[11.5px] py-0.5 px-3 hover:bg-[var(--s2)] truncate",
              activeId === e.id
                ? "text-[var(--cedar-glow)] bg-[var(--cedar-dim)]"
                : "text-[var(--text2,var(--text))]",
            ].join(" ")}
            style={{ paddingLeft: 12 + (e.level - 1) * 10 }}
            title={e.text}
          >
            {e.text}
          </button>
        ))}
      </div>
    </div>
  );
}
