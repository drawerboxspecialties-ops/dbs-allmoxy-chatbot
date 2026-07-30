"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceTyping } from "@/hooks/use-voice-typing";
import {
  loadLocalLearnings,
  mergeLearningLists,
  saveLocalLearnings,
  upsertLocalLearning,
} from "@/lib/learning/client";
import type { LearningEntry } from "@/lib/learning/types";
import { appendTranscript } from "@/lib/voice/polish-transcript";
import { LoginForm } from "./login-form";
import { MarkdownMessage } from "./markdown-message";
import { MicIcon } from "./mic-icon";

const SUGGESTIONS = [
  "How many orders are in each status?",
  "Look up order 603051 and explain ship date + balance",
  "Margin report for today by ship date with CSV",
  "Company snapshot for C004321 with recent orders",
];

function messageText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
}

function toolLabel(type: string) {
  return type.replace(/^tool-/, "").replace(/([A-Z])/g, " $1");
}

function toolDownload(part: {
  type: string;
  output?: unknown;
  result?: unknown;
}) {
  const raw =
    part.output && typeof part.output === "object"
      ? part.output
      : part.result && typeof part.result === "object"
        ? part.result
        : null;
  if (!raw || typeof raw !== "object") return null;
  const data = raw as {
    download_url?: unknown;
    download_label?: unknown;
    summary?: unknown;
  };
  const href = typeof data.download_url === "string" ? data.download_url : "";
  if (!href) return null;
  return {
    href,
    label:
      typeof data.download_label === "string"
        ? data.download_label
        : "Download CSV",
    summary: typeof data.summary === "string" ? data.summary : null,
  };
}

function previousUserText(
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>,
  assistantIndex: number,
) {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messageText(messages[i].parts);
    }
  }
  return "";
}

export function ChatApp() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<string | null>(null);
  const [learnings, setLearnings] = useState<LearningEntry[]>([]);
  const [learningCount, setLearningCount] = useState(0);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachTrigger, setTeachTrigger] = useState("");
  const [teachContent, setTeachContent] = useState("");
  const [teachStatus, setTeachStatus] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<Record<string, string>>({});
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [voicePolishing, setVoicePolishing] = useState(false);
  const baseInputRef = useRef("");
  const learningsRef = useRef<LearningEntry[]>([]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id, body }) => ({
          body: {
            ...body,
            id,
            messages,
            learnings: learningsRef.current,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport,
  });

  const voice = useVoiceTyping({
    onBusyChange: setVoicePolishing,
    onTranscript: (text, isFinal, meta) => {
      if (!isFinal) {
        setVoiceDraft(text);
        return;
      }

      setVoiceDraft("");
      const merged = appendTranscript(baseInputRef.current, text);
      baseInputRef.current = merged;
      setInput(merged);

      // Whisper/Gemini path is already polished server-side.
      if (meta?.engine === "whisper") return;

      // Browser STT: second-pass DeepSeek cleanup.
      setVoicePolishing(true);
      void fetch("/api/voice/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: merged }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { text?: string };
          const cleaned = String(data.text ?? "").trim();
          if (!cleaned) return;
          baseInputRef.current = cleaned;
          setInput(cleaned);
        })
        .catch(() => {
          // Keep local polish if AI cleanup fails.
        })
        .finally(() => setVoicePolishing(false));
    },
  });

  useEffect(() => {
    learningsRef.current = learnings;
    setLearningCount(learnings.length);
  }, [learnings]);

  useEffect(() => {
    fetch("/api/health/allmoxy")
      .then(async (res) => {
        if (res.status === 401) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          orders_total_entries?: number;
        };
        if (data.ok) {
          setHealth(
            `Allmoxy live · ${data.orders_total_entries ?? "?"} orders`,
          );
        } else {
          setHealth(data.error ?? "Allmoxy connection failed");
        }
      })
      .catch(() => setAuthed(false))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!authed) return;
    const local = loadLocalLearnings();
    fetch("/api/learning")
      .then(async (res) => {
        if (!res.ok) {
          setLearnings(local);
          return;
        }
        const data = (await res.json()) as { learnings?: LearningEntry[] };
        const merged = mergeLearningLists(local, data.learnings ?? []);
        setLearnings(merged);
        saveLocalLearnings(merged);
      })
      .catch(() => setLearnings(local));
  }, [authed]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthed(false);
    setMessages([]);
    setHealth(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    if (voice.listening) voice.stop();
    setInput("");
    baseInputRef.current = "";
    setVoiceDraft("");
    await sendMessage({ text });
  }

  async function submitTeach(event: FormEvent) {
    event.preventDefault();
    setTeachStatus(null);
    const trigger = teachTrigger.trim();
    const content = teachContent.trim();
    if (!trigger || !content) {
      setTeachStatus("Add both a topic and what to remember.");
      return;
    }

    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger, content, kind: "fact" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeachStatus(data.error || "Could not save learning.");
        return;
      }
      const entry = data.learning as LearningEntry;
      const next = upsertLocalLearning(entry);
      setLearnings(mergeLearningLists(next, learnings));
      setTeachTrigger("");
      setTeachContent("");
      setTeachStatus("Saved — the bot will use this on future answers.");
    } catch {
      setTeachStatus("Could not save learning.");
    }
  }

  async function sendFeedback(options: {
    messageId: string;
    helpful: boolean;
    question: string;
    answerSnippet: string;
    note?: string;
  }) {
    try {
      const res = await fetch("/api/learning/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          helpful: options.helpful,
          question: options.question,
          answerSnippet: options.answerSnippet,
          note: options.note,
        }),
      });
      const data = await res.json();
      if (res.ok && data.learning) {
        const next = upsertLocalLearning(data.learning as LearningEntry);
        setLearnings(mergeLearningLists(next, learnings));
      }
      setFeedbackFor(null);
      setFeedbackNote((prev) => ({ ...prev, [options.messageId]: "" }));
    } catch {
      // Feedback should never break chat.
    }
  }

  if (!checked) {
    return <div className="boot">Starting Allmoxy chatbot</div>;
  }

  if (!authed) {
    return (
      <div className="shell">
        <section className="login-stage">
          <div className="brand-lockup">
            <p className="brand-kicker">Drawer Box Specialties</p>
            <h1 className="brand-title">
              DBS
              <span>Allmoxy Chatbot</span>
            </h1>
            <p className="brand-lede">
              Live Allmoxy intelligence for orders, customers, invoices, and
              payments — built for the floor and the front office.
            </p>
          </div>
          <div className="login-access">
            <LoginForm
              onSuccess={() => {
                setAuthed(true);
                fetch("/api/health/allmoxy")
                  .then((res) => res.json())
                  .then((data) => {
                    if (data.ok) {
                      setHealth(
                        `Allmoxy live · ${data.orders_total_entries ?? "?"} orders`,
                      );
                    } else {
                      setHealth(data.error ?? "Allmoxy connection failed");
                    }
                  })
                  .catch(() => setHealth("Allmoxy health check failed"));
              }}
            />
          </div>
        </section>
      </div>
    );
  }

  const busy = status !== "ready";
  const composerValue = voiceDraft
    ? `${input}${input ? " " : ""}${voiceDraft}`.trim()
    : input;

  return (
    <div className="chat-shell">
      <header className="topbar">
        <div>
          <p className="brand-kicker">Drawer Box Specialties</p>
          <h1 className="brand-title">
            DBS
            <span>Allmoxy Chatbot</span>
          </h1>
        </div>
        <div className="topbar-actions">
          {health ? <span className="health">{health}</span> : null}
          <span className="health learn-chip" title="Staff-taught memory items">
            Learning · {learningCount}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => setTeachOpen((v) => !v)}
          >
            {teachOpen ? "Close teach" : "Teach"}
          </button>
          <button type="button" className="ghost" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {teachOpen ? (
        <section className="teach-panel">
          <div>
            <h2>Teach the bot</h2>
            <p>
              Save aliases, corrections, and shop preferences. Also works inline:
              type <code>Remember: …</code> or <code>Actually: …</code>
            </p>
          </div>
          <form className="teach-form" onSubmit={submitTeach}>
            <input
              value={teachTrigger}
              onChange={(e) => setTeachTrigger(e.target.value)}
              placeholder="Topic (e.g. C004321 or ship date)"
            />
            <input
              value={teachContent}
              onChange={(e) => setTeachContent(e.target.value)}
              placeholder="What should it remember?"
            />
            <button type="submit">Save learning</button>
          </form>
          {teachStatus ? <p className="teach-status">{teachStatus}</p> : null}
        </section>
      ) : null}

      <main className="chat-main">
        {messages.length === 0 ? (
          <section className="empty">
            <h2 className="empty-title">Ask the plant. Get the record.</h2>
            <p className="empty-copy">
              Order numbers, job names, customer codes, invoices, and payments —
              answered from live Allmoxy data. Use the mic to voice-type, and Teach
              to make answers improve over time.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => sendMessage({ text: suggestion })}
                  disabled={busy}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="messages">
            {messages.map((message, messageIndex) => (
              <article
                key={message.id}
                className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
              >
                <span className="role">
                  {message.role === "user" ? "You" : "Allmoxy Chatbot"}
                </span>
                {message.parts.map((part, index) => {
                  if (part.type === "text" && part.text) {
                    if (message.role === "assistant") {
                      return (
                        <MarkdownMessage
                          key={`${message.id}-${index}`}
                          text={part.text}
                        />
                      );
                    }
                    return (
                      <p key={`${message.id}-${index}`} className="text">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const state =
                      "state" in part ? String(part.state) : "running";
                    if (state === "output-available" || state === "result") {
                      const file = toolDownload(
                        part as {
                          type: string;
                          output?: unknown;
                          result?: unknown;
                        },
                      );
                      if (!file) return null;
                      return (
                        <div
                          key={`${message.id}-${index}`}
                          className="download-card"
                        >
                          {file.summary ? (
                            <p className="download-summary">{file.summary}</p>
                          ) : null}
                          <a className="download-btn" href={file.href}>
                            {file.label}
                          </a>
                        </div>
                      );
                    }
                    return (
                      <p
                        key={`${message.id}-${index}`}
                        className="tool-chip"
                      >
                        Looking up {toolLabel(part.type)}…
                      </p>
                    );
                  }
                  return null;
                })}
                {!messageText(message.parts) &&
                message.parts.some((p) => p.type.startsWith("tool-")) ? (
                  <p className="text muted">Looking up Allmoxy…</p>
                ) : null}
                {!messageText(message.parts) &&
                !message.parts.some((p) => p.type.startsWith("tool-")) ? (
                  <p className="text muted">…</p>
                ) : null}

                {message.role === "assistant" &&
                messageText(message.parts) &&
                !busy ? (
                  <div className="feedback-row">
                    <button
                      type="button"
                      className="feedback-btn"
                      onClick={() =>
                        sendFeedback({
                          messageId: message.id,
                          helpful: true,
                          question: previousUserText(messages, messageIndex),
                          answerSnippet: messageText(message.parts).slice(0, 280),
                        })
                      }
                    >
                      Helpful
                    </button>
                    <button
                      type="button"
                      className="feedback-btn"
                      onClick={() =>
                        setFeedbackFor((id) =>
                          id === message.id ? null : message.id,
                        )
                      }
                    >
                      Needs fix
                    </button>
                    {feedbackFor === message.id ? (
                      <form
                        className="feedback-note"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void sendFeedback({
                            messageId: message.id,
                            helpful: false,
                            question: previousUserText(messages, messageIndex),
                            answerSnippet: messageText(message.parts).slice(
                              0,
                              280,
                            ),
                            note: feedbackNote[message.id],
                          });
                        }}
                      >
                        <input
                          value={feedbackNote[message.id] ?? ""}
                          onChange={(e) =>
                            setFeedbackNote((prev) => ({
                              ...prev,
                              [message.id]: e.target.value,
                            }))
                          }
                          placeholder="What should it do next time?"
                        />
                        <button type="submit">Save</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {error ? (
          <p className="form-error banner">
            {error.message || "Chat request failed"}
          </p>
        ) : null}
        {voice.error ? (
          <p className="form-error banner">{voice.error}</p>
        ) : null}
        {voicePolishing ? (
          <p className="banner muted">
            {voice.mode === "whisper"
              ? "Transcribing with AI speech engine…"
              : "Cleaning up voice transcript…"}
          </p>
        ) : null}
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={composerValue}
          onChange={(e) => {
            setInput(e.target.value);
            baseInputRef.current = e.target.value;
            setVoiceDraft("");
          }}
          placeholder={
            voice.listening
              ? voice.mode === "whisper"
                ? "Recording — click mic again when done…"
                : "Listening — say one clear question, then pause…"
              : voicePolishing
                ? "Transcribing voice…"
                : "Ask about an order, customer, invoice, or payment…"
          }
          disabled={busy || voicePolishing}
        />
        <div className="composer-actions">
          <button
            type="button"
            className={`mic-btn ${voice.listening ? "listening" : ""}`}
            onClick={() => {
              if (!voice.listening) {
                baseInputRef.current = input.trim();
                setVoiceDraft("");
              }
              voice.toggle();
            }}
            disabled={!voice.supported || busy || voicePolishing}
            title={
              voice.supported
                ? voice.listening
                  ? "Stop recording"
                  : voice.mode === "whisper"
                    ? `Voice type (${voice.engineLabel}) — click, speak, click stop`
                    : "Voice type (browser) — one question, then pause"
                : "Microphone not available"
            }
            aria-label={voice.listening ? "Stop recording" : "Voice type"}
          >
            <MicIcon listening={voice.listening} />
          </button>
          <button type="submit" disabled={busy || !composerValue.trim()}>
            {busy ? "Running…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
