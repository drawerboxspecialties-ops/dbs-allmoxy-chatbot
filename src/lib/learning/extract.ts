import { addLearning } from "./store";

/**
 * Lightweight self-improvement: detect correction / remember phrases in user text
 * and store them as learnings for future turns.
 */
export function maybeLearnFromUserMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12 || trimmed.length > 400) return false;

  const patterns: Array<{
    re: RegExp;
    kind: "correction" | "alias" | "fact" | "preference";
  }> = [
    {
      re: /^(?:remember(?: that)?|note that|for next time)[:\s]+(.+)$/i,
      kind: "fact",
    },
    {
      re: /^(?:actually|correction)[:\s]+(.+)$/i,
      kind: "correction",
    },
    {
      re: /^when (?:i|we|staff) (?:say|ask|type) ["']?(.+?)["']?[, ]+(?:it )?(?:means|refer to|use)["']?(.+?)["']?\.?$/i,
      kind: "alias",
    },
    {
      re: /^["'](.+?)["']\s*(?:means|=\s*|refers to)\s*["']?(.+?)["']?\.?$/i,
      kind: "alias",
    },
  ];

  for (const { re, kind } of patterns) {
    const match = re.exec(trimmed);
    if (!match) continue;

    if (kind === "alias" && match[1] && match[2]) {
      addLearning({
        kind,
        trigger: match[1].trim(),
        content: match[2].trim(),
        source: "auto",
      });
      return true;
    }

    const body = (match[1] || "").trim();
    if (!body) continue;
    const trigger = body.split(/[—:-]/)[0]?.trim().slice(0, 80) || body.slice(0, 80);
    addLearning({
      kind,
      trigger,
      content: body,
      source: "auto",
    });
    return true;
  }

  return false;
}
