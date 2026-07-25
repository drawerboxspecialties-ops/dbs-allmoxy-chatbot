"use client";

import type { LearningEntry } from "./types";

const STORAGE_KEY = "dbs-allmoxy-learnings-v1";

export function loadLocalLearnings(): LearningEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LearningEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalLearnings(entries: LearningEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
}

export function upsertLocalLearning(entry: LearningEntry) {
  const current = loadLocalLearnings();
  const next = [
    entry,
    ...current.filter(
      (e) =>
        !(
          e.trigger.toLowerCase() === entry.trigger.toLowerCase() &&
          e.content.toLowerCase() === entry.content.toLowerCase()
        ),
    ),
  ].slice(0, 200);
  saveLocalLearnings(next);
  return next;
}

export function mergeLearningLists(
  a: LearningEntry[],
  b: LearningEntry[],
): LearningEntry[] {
  const map = new Map<string, LearningEntry>();
  for (const entry of [...a, ...b]) {
    const key = `${entry.kind}|${entry.trigger.toLowerCase()}|${entry.content.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      map.set(key, entry);
    }
  }
  return [...map.values()].slice(0, 200);
}
