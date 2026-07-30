/**
 * Post-process speech transcripts for DBS / Allmoxy shop-floor language.
 * Fixes common mishears and normalizes order #s, C-codes, and status phrases.
 */

const PHRASE_FIXES: Array<[RegExp, string]> = [
  [/\ball\s*mox(?:y|ie)\b/gi, "Allmoxy"],
  [/\bal\s*mox(?:y|ie)\b/gi, "Allmoxy"],
  [/\balmoxy\b/gi, "Allmoxy"],
  [/\bdrawer\s*box(?:es)?\b/gi, "drawer box"],
  [/\bmargin\s*desk\b/gi, "margin desk"],
  [/\btrue\s*margin\b/gi, "true margin"],
  [/\bmargin\s*report\b/gi, "margin report"],
  [/\bsee\s*code\b/gi, "C-code"],
  [/\bc\s*code\b/gi, "C-code"],
  [/\bcustomer\s*code\b/gi, "C-code"],
  [/\bsea\s*code\b/gi, "C-code"],
  [/\bin\s*voices?\b/gi, "invoices"],
  [/\bin\s*voice\b/gi, "invoice"],
  [/\binvoice\s*is\b/gi, "invoices"],
  [/\bship\s*date\b/gi, "ship date"],
  [/\bshipping\s*date\b/gi, "ship date"],
  [/\bactual\s*ship(?:ping)?\s*date\b/gi, "actual ship date"],
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
  [/\bthis\s*week\b/gi, "this week"],
  [/\bthis\s*month\b/gi, "this month"],
  [/\bdownload\s*c\s*s\s*v\b/gi, "download CSV"],
  [/\bsee\s*s\s*v\b/gi, "CSV"],
  [/\bcsv\b/gi, "CSV"],
];

/** Only map digit words inside an explicit spoken-number run (not free "to"/"for"). */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function collapseSpokenDigits(text: string): string {
  // Prefer collapsing after "order" / "C" / "#" cues (3+ digits).
  let out = text.replace(
    /\b(?:order\s*#?|c(?:-)?code|c|#)\s*((?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)){2,})\b/gi,
    (full, digits: string) => {
      const num = digits
        .split(/\s+/)
        .map((w) => DIGIT_WORDS[w.toLowerCase()] ?? "")
        .join("");
      if (/^order/i.test(full)) return `order ${num}`;
      if (/^c/i.test(full) || /^#/.test(full.trim())) {
        if (/^c/i.test(full.trim())) return `C${num}`;
        return `order ${num}`;
      }
      return num;
    },
  );

  // Standalone 5–7 digit spoken runs (typical order numbers).
  out = out.replace(
    /\b(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)){4,6}\b/gi,
    (match) =>
      match
        .split(/\s+/)
        .map((w) => DIGIT_WORDS[w.toLowerCase()] ?? "")
        .join(""),
  );

  return out;
}

function normalizeCCodes(text: string): string {
  return text
    .replace(/\b(?:c|see|sea)\s*[- ]?\s*(\d{4,6})\b/gi, "C$1")
    .replace(/\bC\s+(\d{4,6})\b/g, "C$1");
}

function normalizeOrderRefs(text: string): string {
  return text
    .replace(/\border\s*#?\s*(\d{3})\s*(\d{3})\b/gi, "order $1$2")
    .replace(/\border\s*#?\s*(\d{2})\s*(\d{2})\s*(\d{2})\b/gi, "order $1$2$3")
    .replace(/\border\s*#?\s*(\d{5,7})\b/gi, "order $1")
    .replace(/\b#\s*(\d{5,7})\b/g, "order $1")
    // "603 051" near order context already handled; also glue bare 3+3 digit pairs
    .replace(/\b(\d{3})\s+(\d{3})\b/g, "$1$2");
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
    if (
      /^(how|what|when|where|who|which|why|can|could|is|are|do|does|did|show|find|look|tell|give|run|pull|get|make)\b/i.test(
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

  const max = Math.min(left.length, right.length);
  for (let n = max; n >= 8; n -= 1) {
    if (leftLower.slice(-n) === rightLower.slice(0, n)) {
      return tidySpacing(`${left}${right.slice(n)}`);
    }
  }

  const needsSpace = !/[\s([{/-]$/.test(left);
  return tidySpacing(`${left}${needsSpace ? " " : ""}${right}`);
}
