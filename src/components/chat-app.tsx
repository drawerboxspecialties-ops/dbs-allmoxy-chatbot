"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LoginForm } from "./login-form";
import { MarkdownMessage } from "./markdown-message";

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
    return <div className="boot">Syncing ops channel</div>;
  }

  if (!authed) {
    return (
      <div className="shell">
        <section className="login-stage">
          <div className="brand-lockup">
            <p className="brand-kicker">Drawer Box Specialties</p>
            <h1 className="brand-title">
              DBS
              <span>Ops Chat</span>
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

  return (
    <div className="chat-shell">
      <header className="topbar">
        <div>
          <p className="brand-kicker">Drawer Box Specialties</p>
          <h1 className="brand-title">
            DBS
            <span>Ops Chat</span>
          </h1>
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
            <h2 className="empty-title">Ask the plant. Get the record.</h2>
            <p className="empty-copy">
              Order numbers, job names, customer codes, invoices, and payments —
              answered from live Allmoxy data.
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
                    // Only show active lookups; hide finished tool noise.
                    if (state === "output-available" || state === "result") {
                      return null;
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
          placeholder="Ask about an order, customer, invoice, or payment…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? "Running…" : "Send"}
        </button>
      </form>
    </div>
  );
}
