import { useEffect } from "react";

export interface ShortcutMap {
  /** Handlers keyed by canonical shortcut: "mod+k", "mod+f", "mod+[", "mod+]", "mod+w", "?", "esc". */
  [key: string]: ((e: KeyboardEvent) => void) | undefined;
}

/** Global keyboard shortcuts. Runs on document keydown.
 *
 * - "mod" matches Cmd (macOS) or Ctrl elsewhere.
 * - Handlers only fire when the user is NOT typing in an input/textarea/contentEditable,
 *   except for "esc" which always fires. "?" requires Shift+/.
 * - Each handler is responsible for calling preventDefault if it wants to suppress
 *   browser defaults — already done for the recognized shortcuts. */
export function useKeyboardShortcuts(map: ShortcutMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (target?.isContentEditable ?? false);

      if (e.key === "Escape") {
        map.esc?.(e);
        return;
      }

      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const handler = map[`mod+${k}`];
        if (handler) {
          e.preventDefault();
          handler(e);
          return;
        }
      }

      if (e.key === "?" && !mod) {
        e.preventDefault();
        map["?"]?.(e);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [map, enabled]);
}
