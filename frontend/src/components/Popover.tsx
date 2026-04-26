import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Position relative to the anchor: "above" (default) or "below" */
  position?: "above" | "below";
}

export default function Popover({ open, onClose, children, position = "above" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={[
        "absolute z-50 left-0 min-w-[200px] rounded-xl border border-[var(--border)]",
        "bg-[var(--surface)] shadow-xl py-1",
        position === "above" ? "bottom-full mb-1" : "top-full mt-1",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
