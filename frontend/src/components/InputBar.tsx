import { useEffect, useRef, useState } from "react";

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export default function InputBar({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Refocus when streaming ends (disabled flips false)
  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const msg = value.trim();
    if (!msg || disabled) return;
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
    onSend(msg);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--surface)]">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Arzeh is thinking…" : "Message Arzeh…"}
          rows={1}
          className={[
            "flex-1 resize-none rounded-xl px-4 py-2.5 text-[14px]",
            "bg-[var(--border)] border border-[var(--border)]",
            "text-[var(--text)] placeholder-[var(--muted)]",
            "focus:outline-none focus:border-[var(--cedar)]",
            "disabled:opacity-50 transition-colors max-h-[200px]",
          ].join(" ")}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className={[
            "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
            "bg-[var(--cedar)] text-white text-[16px]",
            "disabled:opacity-40 hover:bg-[var(--cedar-lt)] transition-colors",
          ].join(" ")}
        >
          ↑
        </button>
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-1.5 text-center">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
