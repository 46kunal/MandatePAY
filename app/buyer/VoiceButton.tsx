'use client';
// OWNER: B. Voice for the request box, using the browser's built-in speech recognition (Chrome, Edge, Safari).
// It types into the text box as the buyer speaks. The buyer reads it, can edit it, and still has to click Create mandate: voice never
// signs or pays. Hidden when the browser has no speech recognition.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../_ui/Icons';
import u from '../_ui/ui.module.css';
import s from './buyer.module.css';

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

export default function VoiceButton({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState('en-US');
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const latest = useRef(value); // what the box holds right now, so words are added after it
  latest.current = value;

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
    r.continuous = true; // keep listening until the buyer presses stop
    r.interimResults = true; // words appear as they are spoken, not after stopping
    const base = latest.current.trim();
    r.onresult = (e) => {
      // In one listening session the results list holds everything said so far (finished and still-forming words).
      let spoken = '';
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
      onChange(`${base} ${spoken.trim()}`.trim().slice(0, 1000));
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
        className={`${u.btn} ${u.btnSecondary} ${s.voiceBtn}`}
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        title="Speak your request. You still check it and click Create mandate."
      >
        <Icon name="mic" />
        {listening ? 'Stop listening' : 'Speak your request'}
        {listening && <span className={s.recDot} aria-hidden="true" />}
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
