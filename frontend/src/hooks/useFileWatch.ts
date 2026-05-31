// SSE-backed live-reload for the FileViewer.
//
// Subscribes to /api/files/watch?path=... and fires `onContent` every
// time the gateway notices the file's mtime changed. The hook is
// pause-able via `enabled` so an editing user (Monaco unsaved) doesn't
// have their buffer overwritten by an external rewrite mid-keystroke.

import { useEffect, useRef, useState } from "react";

export type FileWatchStatus = "idle" | "connecting" | "open" | "error";

export function useFileWatch(
  filePath: string | null,
  enabled: boolean,
  onContent: (content: string) => void,
): { status: FileWatchStatus } {
  const cbRef = useRef(onContent);
  cbRef.current = onContent;
  const [status, setStatus] = useState<FileWatchStatus>("idle");

  useEffect(() => {
    if (!filePath || !enabled) {
      setStatus("idle");
      return;
    }
    setStatus("connecting");
    const url = `/api/files/watch?path=${encodeURIComponent(filePath)}`;
    const es = new EventSource(url);
    es.addEventListener("open", () => setStatus("open"));
    // Default message channel carries `{content, mtime}` JSON.
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (typeof d?.content === "string") cbRef.current(d.content);
      } catch {
        // ignore — keepalive comment lines surface as empty messages
      }
    };
    es.addEventListener("truncated", () => {
      // File grew past read cap — caller should fall back to manual refresh.
      setStatus("error");
    });
    es.onerror = () => setStatus("error");
    return () => {
      es.close();
      setStatus("idle");
    };
  }, [filePath, enabled]);

  return { status };
}
