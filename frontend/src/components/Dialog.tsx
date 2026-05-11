// Dialog — Cedar-styled replacements for window.confirm / alert / prompt.
// Mount <DialogProvider> once at the App root, then call useDialog()
// in any component:
//
//   const { confirm, notify, prompt } = useDialog();
//   if (await confirm({ title: "Delete?", body: "Cannot be undone." })) ...
//   await notify({ title: "Saved", tone: "ok" });
//   const name = await prompt({ title: "Folder name" });
//
// All three return a Promise so call sites stay tight. The implementation
// keeps a stack so overlapping dialogs render sanely.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CedarModal, CedarInput, Btn } from "./CedarUI";

type Tone = "ok" | "warn" | "danger" | "info";

interface ConfirmOpts {
  title: ReactNode;
  body?: ReactNode;
  okLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  eyebrow?: string;
}

interface NotifyOpts {
  title: ReactNode;
  body?: ReactNode;
  tone?: Tone;
  okLabel?: string;
  eyebrow?: string;
}

interface PromptOpts {
  title: ReactNode;
  body?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  eyebrow?: string;
}

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  notify: (opts: NotifyOpts) => Promise<void>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialog must be inside <DialogProvider>");
  return v;
}

type Entry =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "notify"; opts: NotifyOpts; resolve: () => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);
  const idRef = useRef(0);

  const push = useCallback((e: Entry) => {
    idRef.current += 1;
    setStack((s) => [...s, e]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => push({ kind: "confirm", opts, resolve })),
      notify: (opts) =>
        new Promise<void>((resolve) => push({ kind: "notify", opts, resolve })),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => push({ kind: "prompt", opts, resolve })),
    }),
    [push],
  );

  const top = stack[stack.length - 1];

  return (
    <Ctx.Provider value={api}>
      {children}
      {top && (
        <DialogHost
          key={stack.length}
          entry={top}
          onResolve={(v) => {
            pop();
            if (top.kind === "confirm") (top.resolve as (b: boolean) => void)(v as boolean);
            else if (top.kind === "notify") (top.resolve as () => void)();
            else (top.resolve as (s: string | null) => void)(v as string | null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function toneKind(t: Tone | undefined): "solid" | "danger" {
  return t === "danger" ? "danger" : "solid";
}

function DialogHost({
  entry,
  onResolve,
}: {
  entry: Entry;
  onResolve: (v: boolean | string | null) => void;
}) {
  if (entry.kind === "confirm") {
    const { opts } = entry;
    return (
      <CedarModal
        open
        onClose={() => onResolve(false)}
        title={opts.title}
        eyebrow={opts.eyebrow ?? (opts.tone === "danger" ? "confirm" : undefined)}
        width={460}
        footer={
          <>
            <Btn kind="ghost" onClick={() => onResolve(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </Btn>
            <Btn kind={toneKind(opts.tone)} onClick={() => onResolve(true)}>
              {opts.okLabel ?? (opts.tone === "danger" ? "Delete" : "OK")}
            </Btn>
          </>
        }
      >
        {opts.body ? (
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>{opts.body}</div>
        ) : null}
      </CedarModal>
    );
  }
  if (entry.kind === "notify") {
    const { opts } = entry;
    return (
      <CedarModal
        open
        onClose={() => onResolve(null)}
        title={opts.title}
        eyebrow={opts.eyebrow}
        width={460}
        footer={
          <Btn kind="solid" onClick={() => onResolve(null)}>
            {opts.okLabel ?? "OK"}
          </Btn>
        }
      >
        {opts.body ? (
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>{opts.body}</div>
        ) : null}
      </CedarModal>
    );
  }
  return <PromptDialog opts={entry.opts} onResolve={(v) => onResolve(v)} />;
}

function PromptDialog({
  opts,
  onResolve,
}: {
  opts: PromptOpts;
  onResolve: (v: string | null) => void;
}) {
  const [v, setV] = useState(opts.defaultValue ?? "");
  return (
    <CedarModal
      open
      onClose={() => onResolve(null)}
      title={opts.title}
      eyebrow={opts.eyebrow}
      width={460}
      footer={
        <>
          <Btn kind="ghost" onClick={() => onResolve(null)}>
            {opts.cancelLabel ?? "Cancel"}
          </Btn>
          <Btn kind="solid" onClick={() => onResolve(v)} disabled={!v.trim()}>
            {opts.okLabel ?? "OK"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {opts.body ? (
          <div style={{ fontSize: 13, color: "var(--text2)" }}>{opts.body}</div>
        ) : null}
        <CedarInput
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={opts.placeholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) onResolve(v);
          }}
        />
      </div>
    </CedarModal>
  );
}
