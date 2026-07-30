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

function preferOpsAlternative(result: SpeechRecognitionResultLike): string {
  let chosen = result[0]?.transcript ?? "";
  let chosenScore = result[0]?.confidence ?? 0;

  const opsHint =
    /\b(?:order|c\d{4,}|\d{5,7}|allmoxy|invoice|ship|company|status|margin|csv|snapshot)\b/i;
  const digitHeavy = /(?:\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b.*){3,}/i;

  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i];
    if (!alt?.transcript) continue;
    const score = alt.confidence ?? 0;
    let boosted = score;
    if (opsHint.test(alt.transcript)) boosted += 0.12;
    if (digitHeavy.test(alt.transcript)) boosted += 0.06;
    if (/\b\d{5,7}\b/.test(alt.transcript)) boosted += 0.1;
    if (boosted > chosenScore) {
      chosen = alt.transcript;
      chosenScore = boosted;
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
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()));
  }, []);

  const stop = useCallback(() => {
    wantListenRef.current = false;
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
      setError("Voice typing needs Chrome or Edge on desktop.");
      return;
    }

    setError(null);
    wantListenRef.current = true;

    // Tear down any prior instance first.
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }

    const recognition = new Ctor();
    // Utterance mode: one phrase per mic press. Much more accurate than
    // continuous Chrome sessions that restart and garble mid-sentence.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = options.lang ?? "en-US";
    recognition.maxAlternatives = 5;

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
      if (code === "aborted" || code === "no-speech") {
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone blocked. Allow mic access in the browser and retry.");
        wantListenRef.current = false;
        setListening(false);
        return;
      }
      if (code === "network") {
        setError("Voice network error. Check connection and try again.");
        wantListenRef.current = false;
        setListening(false);
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
      wantListenRef.current = false;
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Could not start microphone. Click mic again.");
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
