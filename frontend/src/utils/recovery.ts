// Automatic continuations the server sends when a turn ends early
// (src/arz/recovery.py). They're stored as user messages but the user
// didn't write them, so the transcript shows a compact system chip.

const RECOVERY_RE = /^\s*\[([^\]]+?) — automatic recovery\]\s*\n?([\s\S]*)$/;

export interface RecoveryNote {
  label: string;
  body: string;
}

export function parseRecovery(text: string): RecoveryNote | null {
  const m = RECOVERY_RE.exec(text || "");
  return m ? { label: m[1], body: m[2].trim() } : null;
}
