/**
 * Post-process speech transcripts for DBS / Allmoxy shop-floor language.
 * Fixes common mishears and normalizes order #s, C-codes, and status phrases.
 */

const PHRASE_FIXES: Array<[RegExp, string]> = [
  [/\ball\s*mox(?:y|ie)\b/gi, "Allmoxy"],
  [/\bal\s*mox(?:y|ie)\b/gi, "Allmoxy"],
  [/\balmoxy\b/gi, "Allmoxy"],
  [/\bsee\s*code\b/gi, "C-code"],
  [/\bc\s*code\b/gi, "C-code"],
  [/\bcustomer\s*code\b/gi, "C-code"],
  [/\bsea\s*code\b/gi, "C-code"],
  [/\bin\s*voices?\b/gi, "invoices"],
  [/\binvoice\s*is\b/gi, "invoices"],
  [/\bship\s*date\b/gi, "ship date"],
  [/\bshipping\s*date\b/gi, "ship date"],
  [/\bin\s*progress\b/gi, "In Progress"],
  [/\bon\s*hold\b/gi, "On Hold"],
  [/\border\s*number\b/gi, "order"],
  [/\border\s*#\b/gi, "order"],
  [/\blook\s*up\b/gi, "look up"],
  [/\bcompany\s*snap\s*shot\b/gi, "company snapshot"],
  [/\bsnap\s*shot\b/gi, "snapshot"],
  [/\bwill\s*call\b/gi, "Will Call"],
  [/\bold\s*dominion\b/gi, "Old Dominion"],
  [/\bnew\s*mark\b/gi, "Numark"],
  [/\bnewmark\b/gi, "Numark"],
];

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
};

function collapseSpokenDigits(text: string): string {
  // "six zero three zero five one" → "603051" when 4+ digit words in a row
  return text.replace(
    /\b(?:zero|oh|o|one|two|to|too|three|four|for|five|six|seven|eight|ate|nine)(?:\s+(?:zero|oh|o|one|two|to|too|three|four|for|five|six|seven|eight|ate|nine)){3,}\b/gi,
    (match) =>
      match
        .split(/\s+/)
        .map((w) => DIGIT_WORDS[w.toLowerCase()] ?? "")
        .join(""),
  );
}

function normalizeCCodes(text: string): string {
  // "C 004321", "see 004321", "c-004321" → "C004321"
  return text
    .replace(/\b(?:c|see|sea)\s*[- ]?\s*(\d{4,6})\b/gi, "C$1")
    .replace(/\bC\s+(\d{4,6})\b/g, "C$1");
}

function normalizeOrderRefs(text: string): string {
  // "order 603 051" / "order # 603051" → "order 603051"
  return text
    .replace(/\border\s*#?\s*(\d{3})\s*(\d{3})\b/gi, "order $1$2")
    .replace(/\border\s*#?\s*(\d{5,7})\b/gi, "order $1")
    .replace(/\b#\s*(\d{5,7})\b/g, "order $1");
}

function tidySpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([?!,.;:])/g, "$1")
    .replace(/([?!,.;:])([^\s])/g, "$1 $2")
    .trim();
}

function capitalizeSentence(text: string): string {
  if (!text) return text;
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_, left: string, ch: string) => {
    return `${left}${ch.toUpperCase()}`;
  });
}

/** Clean a final (or interim) speech chunk for ops chat. */
export function polishTranscript(raw: string, opts?: { final?: boolean }): string {
  let text = raw.replace(/[\u00A0]/g, " ").trim();
  if (!text) return "";

  for (const [re, replacement] of PHRASE_FIXES) {
    text = text.replace(re, replacement);
  }

  text = collapseSpokenDigits(text);
  text = normalizeCCodes(text);
  text = normalizeOrderRefs(text);
  text = tidySpacing(text);

  if (opts?.final) {
    text = capitalizeSentence(text);
    // Soft end punctuation for questions
    if (
      /^(how|what|when|where|who|which|why|can|could|is|are|do|does|did|show|find|look|tell|give)\b/i.test(
        text,
      ) &&
      !/[.!?]$/.test(text)
    ) {
      text = `${text}?`;
    }
  }

  return text;
}

/** Merge a new final chunk onto existing composer text without duplicating tails. */
export function appendTranscript(base: string, chunk: string): string {
  const left = base.trim();
  const right = polishTranscript(chunk, { final: true });
  if (!right) return left;
  if (!left) return right;

  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  if (leftLower.endsWith(rightLower)) return left;
  if (rightLower.startsWith(leftLower)) return right;

  // If the new chunk overlaps the end of the base, stitch cleanly.
  const max = Math.min(left.length, right.length);
  for (let n = max; n >= 8; n -= 1) {
    if (leftLower.slice(-n) === rightLower.slice(0, n)) {
      return tidySpacing(`${left}${right.slice(n)}`);
    }
  }

  const needsSpace = !/[\s([{/-]$/.test(left);
  return tidySpacing(`${left}${needsSpace ? " " : ""}${right}`);
}
