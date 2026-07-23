"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LoginForm } from "./login-form";

const SUGGESTIONS = [
  "How many orders are in each status?",
  "Find company Acme and their open invoices",
  "Show recent payments this month",
  "Look up order by name or number",
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

export function ChatApp() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<string | null>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport,
  });

  useEffect(() => {
    // Cookie presence is enough for UI; APIs enforce signature.
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
            `Allmoxy connected · ${data.orders_total_entries ?? "?"} orders visible`,
          );
        } else {
          setHealth(data.error ?? "Allmoxy connection failed");
        }
      })
      .catch(() => setAuthed(false))
      .finally(() => setChecked(true));
  }, []);

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
    setInput("");
    await sendMessage({ text });
  }

  if (!checked) {
    return <div className="boot">Loading…</div>;
  }

  if (!authed) {
    return (
      <div className="shell">
        <div className="login-panel">
          <p className="eyebrow">Drawer Box Specialties</p>
          <h1>DBS Ops Chat</h1>
          <p className="lede">
            Internal Allmoxy assistant for orders, customers, invoices, and
            payments.
          </p>
          <LoginForm
            onSuccess={() => {
              setAuthed(true);
              fetch("/api/health/allmoxy")
                .then((res) => res.json())
                .then((data) => {
                  if (data.ok) {
                    setHealth(
                      `Allmoxy connected · ${data.orders_total_entries ?? "?"} orders visible`,
                    );
                  } else {
                    setHealth(data.error ?? "Allmoxy connection failed");
                  }
                })
                .catch(() => setHealth("Allmoxy health check failed"));
            }}
          />
        </div>
      </div>
    );
  }

  const busy = status !== "ready";

  return (
    <div className="shell chat-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Drawer Box Specialties</p>
          <h1>DBS Ops Chat</h1>
        </div>
        <div className="topbar-actions">
          {health ? <span className="health">{health}</span> : null}
          <button type="button" className="ghost" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="chat-main">
        {messages.length === 0 ? (
          <section className="empty">
            <p>Ask about a customer, order, invoice, or payment.</p>
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
            {messages.map((message) => (
              <article
                key={message.id}
                className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
              >
                <span className="role">
                  {message.role === "user" ? "You" : "Ops Chat"}
                </span>
                {message.parts.map((part, index) => {
                  if (part.type === "text" && part.text) {
                    return (
                      <p key={`${message.id}-${index}`} className="text">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const state =
                      "state" in part ? String(part.state) : "running";
                    return (
                      <p
                        key={`${message.id}-${index}`}
                        className="tool-chip"
                      >
                        {toolLabel(part.type)} · {state}
                      </p>
                    );
                  }
                  return null;
                })}
                {!messageText(message.parts) &&
                !message.parts.some((p) => p.type.startsWith("tool-")) ? (
                  <p className="text muted">…</p>
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
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What’s the status of order 12345?"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}
