'use client';
// OWNER: B. Voice for the request box, using the browser's built-in speech recognition (Chrome, Edge, Safari).
// It only fills the text box. The buyer reads it, can edit it, and still has to click Create mandate: voice never
// signs or pays. Hidden when the browser has no speech recognition.
import { useEffect, useRef, useState } from 'react';
import u from '../_ui/ui.module.css';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const LANGS = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi' },
];

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in your browser, or type your request instead.',
  'service-not-allowed': 'Microphone access was blocked. Allow it in your browser, or type your request instead.',
  'no-speech': 'I did not hear anything. Try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
};

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceButton({ onText, disabled }: { onText: (spoken: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState('en-US');
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(ctor() !== null);
    try {
      const saved = localStorage.getItem('mandatepay.voiceLang');
      if (saved && LANGS.some((l) => l.code === saved)) setLang(saved);
    } catch {
      /* storage can be blocked: the default language is fine */
    }
    return () => rec.current?.stop();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const R = ctor();
    if (!R) return;
    setNote(null);
    const r = new R();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      let spoken = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) spoken += e.results[i][0].transcript;
      if (spoken.trim()) onText(spoken.trim());
    };
    r.onerror = (e) => setNote(ERRORS[e.error] ?? 'Voice input stopped. You can type your request instead.');
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setNote('Voice input could not start. You can type your request instead.');
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`${u.btn} ${u.btnSecondary}`}
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        title="Speak your request. You still check it and click Create mandate."
      >
        {listening ? 'Stop listening' : 'Speak your request'}
      </button>
      <label className={u.srOnly} htmlFor="voice-lang">
        Voice language
      </label>
      <select
        id="voice-lang"
        className={u.input}
        style={{ width: 'auto' }}
        value={lang}
        disabled={listening}
        onChange={(e) => {
          setLang(e.target.value);
          try {
            localStorage.setItem('mandatepay.voiceLang', e.target.value);
          } catch {
            /* not saved: only a convenience */
          }
        }}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <span className={u.muted} role="status" aria-live="polite">
        {listening ? 'Listening…' : (note ?? '')}
      </span>
    </span>
  );
}
