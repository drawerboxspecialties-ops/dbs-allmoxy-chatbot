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

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function preferOpsAlternative(result: SpeechRecognitionResultLike): string {
  let chosen = result[0]?.transcript ?? "";
  let chosenScore = result[0]?.confidence ?? 0;
  const opsHint =
    /\b(?:order|c\d{4,}|\d{5,7}|allmoxy|invoice|ship|company|status|margin|csv|snapshot)\b/i;

  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i];
    if (!alt?.transcript) continue;
    let score = alt.confidence ?? 0;
    if (opsHint.test(alt.transcript)) score += 0.12;
    if (/\b\d{5,7}\b/.test(alt.transcript)) score += 0.1;
    if (score > chosenScore) {
      chosen = alt.transcript;
      chosenScore = score;
    }
  }
  return chosen;
}

export function useVoiceTyping(options: {
  onTranscript: (
    text: string,
    isFinal: boolean,
    meta?: { engine: "whisper" | "browser" },
  ) => void;
  /** Called while uploading/transcribing recorded audio. */
  onBusyChange?: (busy: boolean) => void;
  lang?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"whisper" | "browser">("browser");
  const [engineLabel, setEngineLabel] = useState("browser");

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const onTranscriptRef = useRef(options.onTranscript);
  const onBusyChangeRef = useRef(options.onBusyChange);
  onTranscriptRef.current = options.onTranscript;
  onBusyChangeRef.current = options.onBusyChange;

  useEffect(() => {
    const hasRecorder =
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia);
    const hasBrowserStt = Boolean(getSpeechRecognition());
    setSupported(hasRecorder || hasBrowserStt);

    if (!hasRecorder) {
      setMode("browser");
      setEngineLabel("browser");
      return;
    }

    void fetch("/api/voice/transcribe")
      .then(async (res) => {
        if (!res.ok) {
          setMode(hasBrowserStt ? "browser" : "whisper");
          return;
        }
        const data = (await res.json()) as {
          available?: boolean;
          engines?: string[];
        };
        if (data.available) {
          setMode("whisper");
          setEngineLabel(data.engines?.[0] || "whisper");
        } else {
          setMode(hasBrowserStt ? "browser" : "whisper");
          setEngineLabel("browser");
        }
      })
      .catch(() => {
        setMode(hasBrowserStt ? "browser" : "whisper");
        setEngineLabel("browser");
      });
  }, []);

  const stopTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  const stopBrowser = useCallback(() => {
    wantListenRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const uploadRecording = useCallback(async (blob: Blob) => {
    onBusyChangeRef.current?.(true);
    setError(null);
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      form.append("file", blob, `voice.${ext}`);
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Transcription failed");
      }
      const text = String(data.text ?? "").trim();
      if (!text) throw new Error("No speech detected — try again.");
      onTranscriptRef.current(text, true, { engine: "whisper" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Transcription failed");
    } finally {
      onBusyChangeRef.current?.(false);
    }
  }, []);

  const stopRecorder = useCallback(() => {
    wantListenRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        stopTracks();
        setListening(false);
      }
    } else {
      stopTracks();
      setListening(false);
    }
  }, []);

  const startRecorder = useCallback(async () => {
    setError(null);
    wantListenRef.current = true;
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      const mime = pickMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError("Microphone recording failed.");
        wantListenRef.current = false;
        stopTracks();
        setListening(false);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        stopTracks();
        mediaRecorderRef.current = null;
        setListening(false);
        if (blob.size >= 800) {
          void uploadRecording(blob);
        } else if (wantListenRef.current === false) {
          setError("Recording too short — click mic, speak, then click again.");
        }
      };

      recorder.start(250);
      setListening(true);
    } catch {
      wantListenRef.current = false;
      setError("Microphone permission blocked or unavailable.");
      setListening(false);
    }
  }, [uploadRecording]);

  const startBrowser = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Voice typing needs Chrome/Edge, or a Whisper API key.");
      return;
    }

    setError(null);
    wantListenRef.current = true;
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }

    const recognition = new Ctor();
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
          { engine: "browser" },
        );
      } else if (interim.trim()) {
        onTranscriptRef.current(
          polishTranscript(interim, { final: false }),
          false,
          { engine: "browser" },
        );
      }
    };

    recognition.onerror = (event) => {
      const code = event.error || "voice error";
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone blocked. Allow mic access and retry.");
      } else if (code === "network") {
        setError("Voice network error. Try again.");
      } else if (code === "audio-capture") {
        setError("No microphone found.");
      } else {
        setError(`Voice typing error: ${code}`);
      }
      wantListenRef.current = false;
      setListening(false);
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
      setError("Could not start microphone.");
      wantListenRef.current = false;
      setListening(false);
    }
  }, [options.lang]);

  const stop = useCallback(() => {
    if (mode === "whisper") stopRecorder();
    else stopBrowser();
  }, [mode, stopBrowser, stopRecorder]);

  const start = useCallback(() => {
    if (mode === "whisper") void startRecorder();
    else startBrowser();
  }, [mode, startBrowser, startRecorder]);

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
      try {
        if (mediaRecorderRef.current?.state !== "inactive") {
          mediaRecorderRef.current?.stop();
        }
      } catch {
        // ignore
      }
      stopTracks();
    },
    [],
  );

  return {
    supported,
    listening,
    error,
    mode,
    engineLabel,
    start,
    stop,
    toggle,
  };
}
