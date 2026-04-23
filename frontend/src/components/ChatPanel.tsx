import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { MessageRecord, SessionDetail } from "@/api/client";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";

interface Props {
  sessionId: string;
}

export default function ChatPanel({ sessionId }: Props) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load session history on mount / session change
  useEffect(() => {
    setMessages([]);
    setStreamBuffer("");
    setError(null);
    api.getSession(sessionId)
      .then((s: SessionDetail) => setMessages(s.messages))
      .catch((e: Error) => setError(e.message));
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const handleSend = async (message: string) => {
    const userMsg: MessageRecord = {
      role: "user",
      text: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer("");
    setError(null);

    try {
      const response = await api.sendMessage(sessionId, message);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }

      let fullText = "";
      for await (const chunk of api.streamChat(response)) {
        if (chunk.type === "text_chunk" && chunk.text) {
          fullText += chunk.text;
          setStreamBuffer(fullText);
        } else if (chunk.type === "complete") {
          break;
        } else if (chunk.type === "error") {
          setError(chunk.message ?? "Unknown error");
          break;
        }
      }

      if (fullText) {
        const assistantMsg: MessageRecord = {
          role: "assistant",
          text: fullText,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setStreamBuffer("");
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-6xl mb-4">🌲</span>
            <h2 className="text-[var(--text)] text-xl font-medium mb-2">Hello! I'm Arzeh.</h2>
            <p className="text-[var(--muted)] text-[14px] max-w-xs">
              Your cedar — rooted, persistent, always here.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Live streaming bubble */}
        {streaming && (
          <div className="flex justify-start mb-4">
            <div className="w-7 h-7 rounded-full bg-[var(--cedar)] flex items-center justify-center text-[12px] mr-2 mt-0.5 shrink-0">
              🌲
            </div>
            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-[var(--asst-bg)] border border-[var(--border)] text-[14px] whitespace-pre-wrap">
              {streamBuffer || (
                <span className="text-[var(--muted)] animate-pulse">▍</span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-sm text-center text-[13px] text-red-400 bg-red-900/20 rounded-xl px-4 py-2 mb-4">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
}
