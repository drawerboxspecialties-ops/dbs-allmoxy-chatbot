/**
 * Allmoxy-recommended incremental windowing.
 *
 * Example from Allmoxy engineering:
 * - Run at 10:00 → pull 9:25 → 9:55 (5 min commit buffer)
 * - Next run at 10:30 → pull 9:55 → 10:25
 *
 * Never re-pull "everything since Jan 2025" on a schedule.
 */

export type SyncWindow = {
  startIso: string;
  endIso: string;
  bufferMinutes: number;
  skipped: boolean;
  reason?: string;
};

function envInt(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getSyncBufferMs() {
  return envInt("ALLMOXY_SYNC_BUFFER_MINUTES", 5) * 60_000;
}

/** Max span for a single incremental request window. */
export function getMaxIncrementalWindowMs() {
  return envInt("ALLMOXY_SYNC_MAX_WINDOW_HOURS", 6) * 60 * 60_000;
}

/** First incremental run lookback when no watermark exists yet. */
export function getFirstIncrementalLookbackMs() {
  return envInt("ALLMOXY_SYNC_FIRST_LOOKBACK_HOURS", 6) * 60 * 60_000;
}

export function computeIncrementalWindow(options: {
  watermarkIso: string | null;
  nowMs?: number;
}): SyncWindow {
  const nowMs = options.nowMs ?? Date.now();
  const bufferMs = getSyncBufferMs();
  const endMs = nowMs - bufferMs;

  let startMs = options.watermarkIso
    ? Date.parse(options.watermarkIso)
    : endMs - getFirstIncrementalLookbackMs();

  if (!Number.isFinite(startMs)) {
    startMs = endMs - getFirstIncrementalLookbackMs();
  }

  if (startMs >= endMs) {
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      bufferMinutes: bufferMs / 60_000,
      skipped: true,
      reason: "Window empty (still inside commit buffer or already caught up).",
    };
  }

  const maxWindow = getMaxIncrementalWindowMs();
  if (endMs - startMs > maxWindow) {
    // Chunk catch-up instead of one giant historical pull.
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(startMs + maxWindow).toISOString(),
      bufferMinutes: bufferMs / 60_000,
      skipped: false,
      reason: `Catch-up chunk limited to ${maxWindow / 3_600_000}h to avoid oversized API pulls.`,
    };
  }

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    bufferMinutes: bufferMs / 60_000,
    skipped: false,
  };
}
