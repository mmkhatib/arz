// Monaco-backed edit surface for the FileViewer.
//
// Lazy-loaded so the ~600KB editor bundle doesn't ship in the main
// chunk — users who never open the file panel never download it. The
// parent owns the buffer state + dirty flag + watch-pause logic; this
// wrapper just renders, fires keystroke change callbacks, and shells
// out a Cmd+S → onSave hook so the parent can hit /api/files/write.

import { useTheme } from "@/hooks/useTheme";
import { lazy, Suspense, useEffect } from "react";

const Editor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

interface Props {
  value: string;
  language: string;
  onChange: (next: string) => void;
  onSave: () => void;
}

export function FileEditor({ value, language, onChange, onSave }: Props) {
  const { resolved } = useTheme();
  // Cmd/Ctrl+S handler bound at the window level — Monaco's own
  // keybinding fires too late (after IME composition / focus traps)
  // and we want the parent to be in charge regardless of where focus
  // lives at the moment of the save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]">
          Loading editor…
        </div>
      }
    >
      <Editor
        height="100%"
        defaultLanguage={language}
        language={language}
        value={value}
        theme={resolved === "light" ? "vs" : "vs-dark"}
        onChange={(v) => onChange(v ?? "")}
        options={{
          fontFamily: "var(--fm)",
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          renderLineHighlight: "line",
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </Suspense>
  );
}
