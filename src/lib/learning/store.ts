import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { LearningEntry, LearningInput } from "./types";

const MAX_LEARNINGS = 200;
const MAX_PROMPT_LEARNINGS = 40;

declare global {
  // eslint-disable-next-line no-var
  var __dbsLearningsCache: LearningEntry[] | undefined;
}

function seedPath() {
  return path.join(process.cwd(), "data", "learnings.json");
}

function runtimePath() {
  // Writable on Vercel; durable locally under data/.
  if (process.env.VERCEL) {
    return path.join("/tmp", "dbs-allmoxy-learnings.json");
  }
  return seedPath();
}

function readJsonFile(filePath: string): LearningEntry[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLearningEntry);
  } catch {
    return [];
  }
}

function isLearningEntry(value: unknown): value is LearningEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.trigger === "string" &&
    typeof v.content === "string"
  );
}

function normalizeScore(entry: LearningEntry) {
  return (entry.helpful ?? 0) - (entry.unhelpful ?? 0);
}

function dedupeMerge(lists: LearningEntry[][]): LearningEntry[] {
  const byKey = new Map<string, LearningEntry>();
  for (const list of lists) {
    for (const entry of list) {
      const key = `${entry.kind}|${entry.trigger.toLowerCase()}|${entry.content.toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, entry);
        continue;
      }
      // Keep higher-scored / newer copy.
      const preferNew =
        normalizeScore(entry) > normalizeScore(existing) ||
        (normalizeScore(entry) === normalizeScore(existing) &&
          entry.updatedAt > existing.updatedAt);
      if (preferNew) byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const scoreDiff = normalizeScore(b) - normalizeScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, MAX_LEARNINGS);
}

function writeLearnings(entries: LearningEntry[]) {
  const filePath = runtimePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  global.__dbsLearningsCache = entries;
}

export function listLearnings(): LearningEntry[] {
  if (global.__dbsLearningsCache) {
    return global.__dbsLearningsCache;
  }
  const merged = dedupeMerge([
    readJsonFile(seedPath()),
    readJsonFile(runtimePath()),
  ]);
  global.__dbsLearningsCache = merged;
  return merged;
}

export function addLearning(input: LearningInput): LearningEntry {
  const now = new Date().toISOString();
  const trigger = input.trigger.trim().slice(0, 120);
  const content = input.content.trim().slice(0, 500);
  if (!trigger || !content) {
    throw new Error("Learning needs both a trigger and content");
  }

  const current = listLearnings();
  const existing = current.find(
    (e) =>
      e.trigger.toLowerCase() === trigger.toLowerCase() &&
      e.content.toLowerCase() === content.toLowerCase(),
  );
  if (existing) {
    existing.helpful += 1;
    existing.updatedAt = now;
    writeLearnings(dedupeMerge([[existing], current]));
    return existing;
  }

  const entry: LearningEntry = {
    id: randomUUID(),
    kind: input.kind ?? "fact",
    trigger,
    content,
    helpful: 1,
    unhelpful: 0,
    source: input.source ?? "staff",
    createdAt: now,
    updatedAt: now,
  };
  writeLearnings(dedupeMerge([[entry], current]));
  return entry;
}

export function voteLearning(
  id: string,
  vote: "up" | "down",
): LearningEntry | null {
  const current = listLearnings();
  const entry = current.find((e) => e.id === id);
  if (!entry) return null;
  if (vote === "up") entry.helpful += 1;
  else entry.unhelpful += 1;
  entry.updatedAt = new Date().toISOString();
  // Drop learnings that are clearly bad.
  const next =
    entry.unhelpful >= entry.helpful + 3
      ? current.filter((e) => e.id !== id)
      : current;
  writeLearnings(dedupeMerge([next]));
  return entry.unhelpful >= entry.helpful + 3 ? null : entry;
}

export function recordAnswerFeedback(input: {
  helpful: boolean;
  question?: string;
  answerSnippet?: string;
  note?: string;
}) {
  const now = new Date().toISOString();
  if (input.note?.trim()) {
    return addLearning({
      kind: input.helpful ? "preference" : "correction",
      trigger: (input.question || "answer feedback").trim().slice(0, 120),
      content: input.note.trim().slice(0, 500),
      source: "feedback",
    });
  }

  // Soft signal without a note: store a lightweight preference marker.
  if (!input.helpful && input.answerSnippet) {
    return addLearning({
      kind: "feedback",
      trigger: (input.question || "unhelpful answer").trim().slice(0, 120),
      content: `Avoid this style/content when similar: ${input.answerSnippet.trim().slice(0, 280)}`,
      source: "feedback",
    });
  }

  // Helpful without note — bump a generic quality marker.
  if (input.helpful) {
    const current = listLearnings();
    const marker = current.find((e) => e.id === "quality-marker");
    if (marker) {
      marker.helpful += 1;
      marker.updatedAt = now;
      writeLearnings(current);
      return marker;
    }
    const entry: LearningEntry = {
      id: "quality-marker",
      kind: "preference",
      trigger: "answer quality",
      content: "Staff marked answers helpful — keep concise labeled shop-floor format.",
      helpful: 1,
      unhelpful: 0,
      source: "feedback",
      createdAt: now,
      updatedAt: now,
    };
    writeLearnings(dedupeMerge([[entry], current]));
    return entry;
  }

  return null;
}

export function mergeClientLearnings(
  client: LearningEntry[] | undefined,
): LearningEntry[] {
  if (!client?.length) return listLearnings();
  return dedupeMerge([listLearnings(), client.filter(isLearningEntry)]);
}

export function formatLearningsForPrompt(entries: LearningEntry[]): string {
  const top = entries
    .filter((e) => normalizeScore(e) >= 0)
    .slice(0, MAX_PROMPT_LEARNINGS);
  if (!top.length) {
    return "## Learned knowledge\n(No staff learnings yet. When staff teach corrections, they appear here.)";
  }

  const lines = top.map(
    (e, i) =>
      `${i + 1}. [${e.kind}] ${e.trigger} → ${e.content} (score ${normalizeScore(e)})`,
  );

  return `## Learned knowledge (self-improving memory)
Apply these staff-taught rules when relevant. They override generic style preferences, but never override live Allmoxy tool facts (IDs, amounts, statuses, dates).
${lines.join("\n")}`;
}
