'use client';
// The first page people see. It explains the idea in a few scrolls, then there is one sign-in for everyone: the
// account's role decides what opens (buyers shop, the store team runs the store).
// Motion is limited to what explains something: the request is typed once and the stamp lands once in the hero, and
// sections fade in a little as they arrive. All of it is off for people who ask their device to reduce motion.
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/client';
import '../_ui/ui.module.css'; // loads the shared colour tokens
import c from './landing.module.css';

const REQUEST = 'White running trainers, size 10, under $110, delivered within two weeks';

const LIMITS: [string, string][] = [
  ['Budget', '$110.00 at most'],
  ['Category', 'Trainers'],
  ['Colour and size', 'White, size 10'],
  ['Delivery', 'Within 14 days'],
];

const CHECKS = ['Within budget', 'Size and colour match', 'Arrives in time'];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Fades and rises once when it comes into view. `i` staggers siblings by 50ms (the first six). */
function Reveal({ children, className = '', i = 0, as = 'div' }: { children: ReactNode; className?: string; i?: number; as?: 'div' | 'li' }) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      className={`${c.reveal} ${on ? c.revealOn : ''} ${className}`}
      style={{ ['--i' as string]: Math.min(i, 5) } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** The six links of the record light up once, in order, when the list comes into view. */
function RecordList({ items }: { items: [string, string][] }) {
  const ref = useRef<HTMLOListElement>(null);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setLit(items.length);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        items.forEach((_, n) => timers.push(setTimeout(() => setLit(n + 1), 250 + n * 220)));
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [items]);
  return (
    <ol className={c.record} ref={ref}>
      {items.map(([t, d], n) => (
        <li key={t} className={`${c.recordItem} ${n < lit ? c.recordOn : ''}`}>
          <span className={c.recordNum}>{n + 1}</span>
          <b>{t}</b>
          <span>{d}</span>
        </li>
      ))}
    </ol>
  );
}

/** The hero's mandate: the request types itself once, the limits appear, and the stamp lands. */
function MandateCard() {
  const [chars, setChars] = useState(0);
  const [stage, setStage] = useState(0); // 0 typing, 1 limits shown, 2 stamped

  useEffect(() => {
    if (reducedMotion()) {
      setChars(REQUEST.length);
      setStage(2);
      return;
    }
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, ms));
      });
    (async () => {
      await wait(600);
      for (let i = 1; i <= REQUEST.length && alive; i++) {
        setChars(i);
        await wait(32);
      }
      await wait(240);
      if (alive) setStage(1);
      await wait(700);
      if (alive) setStage(2);
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={c.sheet} role="img" aria-label="A signed mandate for white trainers, size 10, with a budget of 110 dollars, and the cart checked against it">
      <div className={c.sheetHead}>
        <span>Mandate</span>
        <span className={c.mono}>mnd_7f3a91</span>
      </div>
      <p className={c.request}>{REQUEST.slice(0, chars)}</p>
      <div className={c.signBlock}>
        <dl className={`${c.limits} ${stage >= 1 ? c.limitsOn : ''}`}>
          {LIMITS.map(([k, v]) => (
            <div key={k} className={c.limit}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <span className={`${c.stamp} ${stage >= 2 ? c.stampOn : ''}`}>Signed</span>
      </div>
      <div className={`${c.cartCheck} ${stage >= 2 ? c.cartOn : ''}`}>
        <div className={c.cartRow}>
          <span>Aero Runner, white, size 10</span>
          <span className={c.mono}>$89.00</span>
        </div>
        <ul className={`${c.checks} ${stage >= 2 ? c.checksOn : ''}`}>
          {CHECKS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NavActions() {
  const { data } = useSession();
  if (data?.user) {
    return (
      <Link href="/start" className={c.btn}>
        Open your workspace
      </Link>
    );
  }
  return (
    <>
      <Link href="/login" className={c.navLink}>
        Sign in
      </Link>
      <Link href="/login?mode=sign-up" className={c.btn}>
        Get started
      </Link>
    </>
  );
}

function HeroActions() {
  const { data } = useSession();
  if (data?.user) {
    return (
      <div className={c.cta}>
        <Link href="/start" className={`${c.btn} ${c.btnLg}`}>
          Open your workspace
        </Link>
        <a href="#how" className={`${c.btnGhost} ${c.btnLg}`}>
          How it works
        </a>
      </div>
    );
  }
  return (
    <div className={c.cta}>
      <Link href="/login?mode=sign-up" className={`${c.btn} ${c.btnLg}`}>
        Get started
      </Link>
      <Link href="/login" className={`${c.btnGhost} ${c.btnLg}`}>
        Sign in
      </Link>
    </div>
  );
}

const STEPS: [string, string][] = [
  ['Say what you want', 'Type it or speak it: budget, size, colour, and when you need it.'],
  ['Sign your limits', 'Your request becomes a signed mandate. It is yours, and you can cancel it at any time.'],
  ['Shop your way', 'Browse the store yourself or let your agent pick. Every cart is checked against your mandate.'],
  ['Pay with PayPal or card', 'If something is wrong, report it and the store can refund you without a PayPal dispute.'],
];

const RECORD: [string, string][] = [
  ['Request', 'What you asked for'],
  ['Mandate', 'Signed with your key'],
  ['Cart', 'Checked against the mandate'],
  ['Payment', 'PayPal, tied to your account'],
  ['Dispute', 'Read from these records'],
  ['Decision', 'Approved by a person'],
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <div className={c.page}>
      <header className={`${c.nav} ${scrolled ? c.navScrolled : ''}`}>
        <div className={`${c.wrap} ${c.navInner}`}>
          <Link href="/" className={c.brand}>
            <span className={c.mark} aria-hidden="true">
              M
            </span>
            MandatePay
          </Link>
          <nav className={c.navLinks} aria-label="Main">
            <a href="#how" className={c.navLink}>
              How it works
            </a>
            <a href="#disputes" className={c.navLink}>
              Disputes
            </a>
            <a href="#who" className={c.navLink}>
              Who it is for
            </a>
            <NavActions />
          </nav>
        </div>
      </header>

      <main>
        <section className={c.hero}>
          <div className={`${c.wrap} ${c.heroGrid}`}>
            <div>
              <h1 className={`${c.h1} ${c.heroIn}`} style={{ ['--i' as string]: 0 } as CSSProperties}>Let an AI shop for you, and keep proof of what you asked</h1>
              <p className={`${c.lead} ${c.heroIn}`} style={{ ['--i' as string]: 1 } as CSSProperties}>
                Set your limits once. MandatePay signs them, checks every cart against them, and gives the store the record if a payment is
                disputed.
              </p>
              <div className={c.heroIn} style={{ ['--i' as string]: 2 } as CSSProperties}>
                <HeroActions />
              </div>
              <p className={`${c.note} ${c.heroIn}`} style={{ ['--i' as string]: 3 } as CSSProperties}>
                Runs on the PayPal sandbox. No real money moves.
              </p>
            </div>
            <div className={c.heroIn} style={{ ['--i' as string]: 2 } as CSSProperties}>
              <MandateCard />
            </div>
          </div>
        </section>

        <section className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>When an AI buys something, who decides it was the right thing?</h2>
              <p className={c.sub}>Today nobody can prove it. That is a problem for shoppers and for stores.</p>
            </Reveal>
            <div className={c.split}>
              <Reveal i={0}>
                <div className={c.panel}>
                  <h3>Without a record</h3>
                  <p>
                    The agent buys the wrong size. The buyer says they never asked for that, and the store says they did. PayPal has to guess,
                    and honest people lose.
                  </p>
                </div>
              </Reveal>
              <Reveal i={1}>
                <div className={c.panel}>
                  <h3>With MandatePay</h3>
                  <p>
                    What you asked for is signed before anything is bought, and each cart is checked against it. If there is a dispute, that
                    signed record is the evidence.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="how" className={`${c.section} ${c.sectionAlt}`}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>Four steps, and you stay in charge</h2>
              <p className={c.sub}>From a sentence to a paid order, with your limits signed before anything is bought.</p>
            </Reveal>
            <ol className={c.steps}>
              {STEPS.map(([t, d], i) => (
                <Reveal as="li" key={t} i={i} className={c.step}>
                  <span className={c.stepLine} aria-hidden="true" />
                  <span className={c.stepNum}>{i + 1}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>Every step leaves a record</h2>
              <p className={c.sub}>From the first request to the final decision, each link is stored, so a dispute is settled by what happened.</p>
            </Reveal>
            <RecordList items={RECORD} />
          </div>
        </section>

        <section id="disputes" className={`${c.section} ${c.sectionAlt}`}>
          <div className={`${c.wrap} ${c.dispute}`}>
            <Reveal>
              <h2 className={c.h2}>Disputes settled with facts, not guesses</h2>
              <p className={c.sub}>
                When a buyer disputes a payment, an AI analyst reads the signed mandate, the cart and the payment, and recommends what to do.
                A person always has the final say.
              </p>
              <ul className={c.bullets}>
                <li>
                  <b>Built from records.</b> The analyst only uses what was signed, ordered and paid, never anyone&rsquo;s word alone.
                </li>
                <li>
                  <b>Safe by design.</b> Code rules block unsafe actions and double refunds, and send anything the AI is unsure about to a person.
                </li>
                <li>
                  <b>You decide.</b> Nothing is sent to PayPal until a person approves it.
                </li>
              </ul>
            </Reveal>
            <Reveal>
              <div className={c.verdict}>
                <div className={c.verdictHead}>
                  <span>AI recommendation</span>
                  <span>A person approves</span>
                </div>
                <h3>Send the evidence to the buyer</h3>
                <div className={c.meterRow}>
                  <div className={c.meter} role="img" aria-label="85 percent confidence">
                    <div className={c.meterFill} />
                  </div>
                  <span className={c.mono}>85%</span>
                </div>
                <ul className={c.proof}>
                  <li>The buyer signed a mandate for white trainers, size 10</li>
                  <li>The cart matched it: within budget, right size</li>
                  <li>Paid from the buyer&rsquo;s own PayPal account</li>
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="who" className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>For shoppers and for stores</h2>
              <p className={c.sub}>One sign-in. What you see depends on who you are.</p>
            </Reveal>
            <div className={c.cards}>
              <Reveal i={0}>
                <div className={c.card}>
                  <h3>If you shop</h3>
                  <p>Hand the repetitive part of shopping to an agent without giving up control.</p>
                  <ul>
                    <li>Speak or type what you need</li>
                    <li>Browse the store with pictures and prices</li>
                    <li>See your orders and who sold them</li>
                    <li>Report a problem and get a quick refund</li>
                  </ul>
                </div>
              </Reveal>
              <Reveal i={1}>
                <div className={c.card}>
                  <h3>If you run a store</h3>
                  <p>Sell to people and to their agents, with the proof ready when a payment is disputed.</p>
                  <ul>
                    <li>List products with pictures and stock</li>
                    <li>Get disputes analysed when they arrive</li>
                    <li>Send PayPal the evidence in one click</li>
                    <li>Track refunds, results and your team</li>
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className={`${c.section} ${c.sectionAlt}`}>
          <div className={c.wrap}>
            <ul className={c.trust}>
              <Reveal as="li" i={0}>
                <b>Signed mandates</b>
                <span>Your own key, checked every time</span>
              </Reveal>
              <Reveal as="li" i={1}>
                <b>PayPal checkout</b>
                <span>Card details never touch our servers</span>
              </Reveal>
              <Reveal as="li" i={2}>
                <b>A person decides</b>
                <span>The AI recommends, you approve</span>
              </Reveal>
              <Reveal as="li" i={3}>
                <b>Audit trail</b>
                <span>Who did what, and when</span>
              </Reveal>
            </ul>
          </div>
        </section>

        <section id="built" className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>Built on PayPal and AI</h2>
              <p className={c.sub}>Each one has a specific job, and the AI never acts alone: a person approves what is sent to PayPal.</p>
            </Reveal>
            <div className={c.cards}>
              <Reveal i={0}>
                <div className={c.card}>
                  <h3>What PayPal does</h3>
                  <ul>
                    <li>Orders and Card Fields for checkout, with 3-D Secure</li>
                    <li>The Disputes API to send evidence, offers and messages</li>
                    <li>Verified webhooks, so disputes arrive on their own</li>
                    <li>Refunds, read back from PayPal so none is paid twice</li>
                    <li>Log in with PayPal, to match the payer to the buyer</li>
                  </ul>
                </div>
              </Reveal>
              <Reveal i={1}>
                <div className={c.card}>
                  <h3>What the AI does</h3>
                  <ul>
                    <li>Turns a sentence into limits you sign</li>
                    <li>Shops for you, from real products only</li>
                    <li>Settles the cart checks that rules cannot</li>
                    <li>Reads a dispute against the record, scored on 28 labelled cases</li>
                    <li>Is overridden by code rules when an answer would be unsafe</li>
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className={c.final}>
          <div className={c.wrap}>
            <h2 className={c.finalTitle}>Sign your first mandate</h2>
            <p className={c.finalSub}>
              Create an account, say what you want to buy, and watch every cart get checked. It runs on the PayPal sandbox, so no real money moves.
            </p>
            <HeroActions />
          </div>
        </section>
      </main>

      <footer className={c.foot}>
        <div className={c.wrap}>MandatePay · A demo built on the PayPal sandbox</div>
      </footer>
    </div>
  );
}
