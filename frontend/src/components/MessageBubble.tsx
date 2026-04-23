import type { MessageRecord } from "@/api/client";

interface Props {
  message: MessageRecord;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--cedar)] flex items-center justify-center text-[12px] mr-2 mt-0.5 shrink-0">
          🌲
        </div>
      )}
      <div
        className={[
          "max-w-[75%] px-4 py-2.5 rounded-2xl text-[14px] whitespace-pre-wrap break-words",
          isUser
            ? "bg-[var(--user-bg)] text-[var(--text)] rounded-br-sm"
            : "bg-[var(--asst-bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm",
        ].join(" ")}
      >
        {message.text}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--border)] flex items-center justify-center text-[12px] ml-2 mt-0.5 shrink-0">
          👤
        </div>
      )}
    </div>
  );
}
