import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <span className="text-[13px] font-semibold text-[var(--text)]">{label}</span>
      {description && <div className="text-[12px] text-[var(--muted)]">{description}</div>}
      {children}
    </div>
  );
}

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function SettingsToggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <div className="flex-1 min-w-0 mr-4">
        <div className="text-[13px] font-semibold text-[var(--text)]">{label}</div>
        {description && <div className="text-[12px] text-[var(--muted)] mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
        className={`relative w-9 h-5 rounded-full transition-colors flex-none ${
          checked ? "bg-[var(--cedar)]" : "bg-[var(--border)]"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

interface SelectProps {
  label: string;
  description?: string;
  value: string;
  options: string[];
  optionLabels?: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function SettingsSelect({
  label,
  description,
  value,
  options,
  optionLabels,
  onChange,
  disabled,
}: SelectProps) {
  return (
    <Field label={label} description={description}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--cedar)]/40 disabled:opacity-40"
      >
        {options.map((opt, i) => (
          <option key={opt} value={opt}>
            {optionLabels?.[i] ?? opt}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface InputProps {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "number" | "password";
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
}

export function SettingsInput({
  label,
  description,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  disabled,
  multiline,
  rows = 3,
}: InputProps) {
  const className =
    "w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--cedar)]/40 disabled:opacity-40";
  return (
    <Field label={label} description={description}>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className={`${className} resize-y font-mono text-[12px]`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )}
    </Field>
  );
}

export function SettingsSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h4 className="text-[13px] font-semibold text-[var(--text)] mt-4 mb-2 uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-4 mb-3">
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
