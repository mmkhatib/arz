interface Props {
  name: string;
  input: string;
  active?: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  Read: "📄",
  Write: "✏️",
  Edit: "✏️",
  MultiEdit: "✏️",
  Bash: "⚡",
  Glob: "🔍",
  Grep: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Task: "🤖",
  Agent: "🤖",
};

function parsePreview(input: string): string {
  try {
    const obj = JSON.parse(input);
    const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
    if (!first) return "";
    return first.length > 60 ? first.slice(0, 57) + "…" : first;
  } catch {
    return "";
  }
}

export default function ToolCallLine({ name, input, active = true }: Props) {
  const icon = TOOL_ICONS[name] ?? "🔧";
  const preview = parsePreview(input);

  return (
    <div className="flex items-center gap-1.5 text-[12px] py-0.5">
      <span className="text-[11px]">{icon}</span>
      <span
        className={[
          "font-mono font-medium",
          active ? "text-[var(--cedar)]" : "text-[var(--muted)]",
        ].join(" ")}
      >
        {name}
      </span>
      {preview && (
        <span className="text-[var(--muted)] truncate max-w-[220px] opacity-70">
          {preview}
        </span>
      )}
      {active && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] opacity-60 animate-pulse shrink-0" />
      )}
    </div>
  );
}
