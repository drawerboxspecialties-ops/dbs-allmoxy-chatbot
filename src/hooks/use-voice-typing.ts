"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { polishTranscript } from "@/lib/voice/polish-transcript";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string; confidence?: number };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function bestAlternative(result: SpeechRecognitionResultLike): string {
  let best = result[0]?.transcript ?? "";
  let bestScore = result[0]?.confidence ?? -1;
  for (let i = 1; i < result.length; i += 1) {
    const alt = result[i];
    const score = alt?.confidence ?? -1;
    if (score > bestScore) {
      best = alt.transcript;
      bestScore = score;
    }
  }
  return best;
}

function preferOpsAlternative(result: SpeechRecognitionResultLike): string {
  // Prefer alternatives that look like order #s / C-codes when confidence is close.
  let chosen = bestAlternative(result);
  let chosenScore = result[0]?.confidence ?? 0;
  const opsHint =
    /\b(?:order|c\d{4,}|\d{5,7}|allmoxy|invoice|ship|company|status)\b/i;

  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i];
    if (!alt?.transcript) continue;
    const score = alt.confidence ?? 0;
    if (opsHint.test(alt.transcript) && score + 0.08 >= chosenScore) {
      chosen = alt.transcript;
      chosenScore = score;
    }
  }
  return chosen;
}

export function useVoiceTyping(options: {
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()));
  }, []);

  const clearRestart = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    wantListenRef.current = false;
    clearRestart();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      try {
        recognition?.abort();
      } catch {
        // ignore
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Voice typing needs Chrome or Edge.");
      return;
    }

    clearRestart();
    setError(null);
    wantListenRef.current = true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.lang ?? "en-US";
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = preferOpsAlternative(result);
        if (result.isFinal) finalText += `${piece} `;
        else interim += piece;
      }

      if (finalText.trim()) {
        onTranscriptRef.current(
          polishTranscript(finalText, { final: true }),
          true,
        );
      } else if (interim.trim()) {
        onTranscriptRef.current(
          polishTranscript(interim, { final: false }),
          false,
        );
      }
    };

    recognition.onerror = (event) => {
      const code = event.error || "voice error";
      // Benign / recoverable — keep session alive when possible.
      if (code === "aborted" || code === "no-speech") {
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone permission blocked. Allow mic access and try again.");
        wantListenRef.current = false;
        setListening(false);
        return;
      }
      if (code === "network") {
        setError("Voice service network issue — retrying…");
        return;
      }
      if (code === "audio-capture") {
        setError("No microphone found.");
        wantListenRef.current = false;
        setListening(false);
        return;
      }
      setError(`Voice typing error: ${code}`);
    };

    recognition.onend = () => {
      // Chrome ends recognition after pauses — auto-resume while armed.
      if (!wantListenRef.current) {
        setListening(false);
        return;
      }
      clearRestart();
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        try {
          recognition.start();
        } catch {
          setListening(false);
        }
      }, 180);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Could not start microphone.");
      wantListenRef.current = false;
      setListening(false);
    }
  }, [options.lang]);

  const toggle = useCallback(() => {
    if (wantListenRef.current || listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(
    () => () => {
      wantListenRef.current = false;
      clearRestart();
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    },
    [],
  );

  return { supported, listening, error, start, stop, toggle };
}
