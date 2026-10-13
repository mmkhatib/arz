import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ImageOff, X, ZoomIn, ZoomOut } from "lucide-react";

/** Full-screen image viewer. Click backdrop or Esc to close; the zoom
 *  toggle switches between fit-to-screen and natural size (scrollable). */
export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [natural, setNatural] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const btn =
    "w-8 h-8 flex items-center justify-center rounded-md bg-black/50 text-white/80 hover:text-white hover:bg-black/70";
  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-label={alt || "Image preview"}
    >
      <div className="absolute top-3 right-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button className={btn} onClick={() => setNatural((v) => !v)} title={natural ? "Fit to screen" : "Actual size"}>
          {natural ? <ZoomOut size={15} /> : <ZoomIn size={15} />}
        </button>
        <a className={btn} href={src} download title="Download">
          <Download size={15} />
        </a>
        <button className={btn} onClick={onClose} title="Close (Esc)">
          <X size={15} />
        </button>
      </div>
      <div
        className={natural ? "max-w-full max-h-full overflow-auto" : "flex items-center justify-center"}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          style={natural ? { maxWidth: "none" } : { maxWidth: "92vw", maxHeight: "88vh", objectFit: "contain" }}
          className="rounded-md shadow-2xl"
        />
      </div>
      {alt && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[12px] text-white/70 font-mono">{alt}</div>
      )}
    </div>,
    document.body,
  );
}

/** Inline chat image: click opens the lightbox, a broken URL shows a
 *  labelled placeholder instead of the browser's broken-image glyph. */
export function ChatImage({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--border)] text-[11px] text-[var(--muted)] font-mono">
        <ImageOff size={12} /> {alt || "image unavailable"}
      </span>
    );
  }
  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={() => setOpen(true)}
        className="my-2 rounded-lg border border-[var(--border)] cursor-zoom-in max-h-[420px] max-w-full object-contain"
      />
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
