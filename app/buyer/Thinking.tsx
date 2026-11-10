'use client';
// What the page says while the AI works. It rotates through short, dry lines so a wait of a few seconds feels like
// something is happening, and says in plain words what the step is. Screen readers hear one steady "Working on it",
// not a new line every second and a half.
import { useEffect, useMemo, useState } from 'react';
import s from './buyer.module.css';

const WORDS = {
  draft: [
    'Reading your request',
    'Analysing your wishes',
    'Squinting at the fine print',
    'Turning vibes into numbers',
    'Consulting the budget',
    'Negotiating with the size chart',
    'Checking this is not a trick question',
    'Doing the maths, reluctantly',
    'Mesmerising the numbers into shape',
    'Asking the AI to please be precise',
    'Almost done, probably',
  ],
  shop: [
    'Walking the aisles',
    'Comparing prices so you do not have to',
    'Checking the colour twice',
    'Haggling with the catalogue',
    'Ignoring the impulse buys',
    'Reading the size labels properly',
    'Picking something sensible',
  ],
  confirm: ['Signing with your key', 'Finding a very small pen', 'Sealing the paperwork', 'Making it official'],
  check: ['Checking the cart against your mandate', 'Counting the pennies', 'Making sure nothing sneaks in'],
} as const;

export type ThinkingKind = keyof typeof WORDS;

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Thinking({ kind }: { kind: ThinkingKind }) {
  const order = useMemo(() => shuffled(WORDS[kind]), [kind]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % order.length), 1600);
    return () => clearInterval(t);
  }, [order]);
  return (
    <div className={s.thinking} role="status">
      <span className={s.thinkLabel}>Working on it</span>
      <span className={s.thinkBar} aria-hidden="true" />
      <span key={i} className={s.thinkWord} aria-hidden="true">
        {order[i]}…
      </span>
    </div>
  );
}
