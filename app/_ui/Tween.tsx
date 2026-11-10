'use client';
// A number that counts to its value when it first appears and when it changes, then stops. Used for the figures people
// read at a glance, so a change is noticed. Shows the final value at once for people who ask for reduced motion.
import { useEffect, useRef, useState } from 'react';

export function Tween({ value, suffix = '', ms = 600 }: { value: number; suffix?: string; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 4); // same feel as the shared easing curve
      setShown(Math.round(origin + (value - origin) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown}
      {suffix}
    </span>
  );
}
