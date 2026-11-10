'use client';
// The first page people see. It explains the idea in a few scrolls, then there is one sign-in for everyone: the
// account's role decides what opens (buyers shop, the store team runs the store). Animations are gentle and switch
// off for people who ask their device to reduce motion.
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/client';
import c from './landing.module.css';

const REQUEST = 'White running trainers, size 10, under $110, delivered within two weeks';
const CHIPS = ['Budget $110', 'Trainers only', 'Colour: white', 'Size 10', 'Arrives in 14 days'];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Fades and lifts its children in when they scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
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
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${c.reveal} ${on ? c.revealOn : ''} ${className}`} style={{ '--d': `${delay}s` } as CSSProperties}>
      {children}
    </div>
  );
}

/** A thin bar at the very top that fills as the page is scrolled. */
function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${h > 0 ? Math.min(1, window.scrollY / h) : 0})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div ref={bar} className={c.progress} aria-hidden="true" />;
}

/** What the product does, sliding past. Repeats once so the loop is seamless. */
const FEATURES = ['Signed mandates', 'Cart guard', 'Pay with PayPal or card', 'AI dispute analyst', 'A person approves', 'Evidence PDFs', 'Refund protection', 'Full audit trail'];
function Marquee() {
  return (
    <div className={c.marquee} aria-hidden="true">
      <div className={c.track}>
        {[...FEATURES, ...FEATURES].map((f, i) => (
          <span key={i} className={c.pill}>
            <i />
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A number that counts up once it scrolls into view. */
function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setN(to);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - start) / 1100);
          setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <b ref={ref}>
      {n}
      {suffix}
    </b>
  );
}

function Counters() {
  const items: [number, string, string][] = [
    [5, '', 'safety checks on every cart'],
    [4, '', 'steps from request to paid'],
    [2, '', 'ways to pay: PayPal or card'],
    [1, '', 'person approves every response'],
  ];
  return (
    <div className={c.counters}>
      {items.map(([to, suffix, label]) => (
        <div key={label} className={c.counter}>
          <CountUp to={to} suffix={suffix} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Six links light up one after another while the line underneath fills. Starts when it scrolls into view. */
const CHAIN: [string, string, string][] = [
  ['1', 'Request', 'What you asked for'],
  ['2', 'Mandate', 'Signed with your key'],
  ['3', 'Cart', 'Checked against it'],
  ['4', 'Payment', 'PayPal, tied to you'],
  ['5', 'Dispute', 'Read from the records'],
  ['6', 'Decision', 'A person approves'],
];
function ProofChain() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(-1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setOn(CHAIN.length);
      return;
    }
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = async () => {
      while (alive) {
        for (let i = 0; i <= CHAIN.length && alive; i++) {
          setOn(i);
          await new Promise<void>((r) => timers.push(setTimeout(r, 900)));
        }
        await new Promise<void>((r) => timers.push(setTimeout(r, 1800)));
        setOn(-1);
        await new Promise<void>((r) => timers.push(setTimeout(r, 500)));
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void run();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div ref={ref}>
      <div className={c.chain}>
        {CHAIN.map(([n, t, d], i) => (
          <div key={t} className={`${c.link} ${i < on ? c.linkOn : ''}`}>
            <div className={c.linkIcon}>{i < on ? '✓' : n}</div>
            <b>{t}</b>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <div className={c.line} aria-hidden="true">
        <div className={c.lineFill} style={{ width: `${Math.max(0, Math.min(1, on / CHAIN.length)) * 100}%` }} />
      </div>
    </div>
  );
}

/** The hero demo: a request is typed, turns into limits, and gets signed. Then it starts again. */
function HeroDemo() {
  const [chars, setChars] = useState(0);
  const [chips, setChips] = useState(0);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    if (reducedMotion()) {
      setChars(REQUEST.length);
      setChips(CHIPS.length);
      setSigned(true);
      return;
    }
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, ms));
      });
    (async () => {
      while (alive) {
        setChars(0);
        setChips(0);
        setSigned(false);
        await wait(700);
        for (let i = 1; i <= REQUEST.length && alive; i++) {
          setChars(i);
          await wait(38);
        }
        await wait(300);
        for (let i = 1; i <= CHIPS.length && alive; i++) {
          setChips(i);
          await wait(260);
        }
        await wait(500);
        setSigned(true);
        await wait(4200);
      }
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const stage = useRef<HTMLDivElement>(null);
  function tilt(e: React.MouseEvent) {
    const el = stage.current;
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 6}deg)`;
  }
  function untilt() {
    if (stage.current) stage.current.style.transform = '';
  }

  return (
    <div className={`${c.stage} ${c.tilt}`} aria-hidden="true" ref={stage} onMouseMove={tilt} onMouseLeave={untilt}>
      <div className={`${c.float} ${c.floatA}`}>
        <div className={c.floatTitle}>
          <span>What you asked for</span>
          <span>1</span>
        </div>
        <div className={c.typed}>
          {REQUEST.slice(0, chars)}
          <span className={c.caret} />
        </div>
        <div className={c.chips}>
          {CHIPS.map((t, i) => (
            <span key={t} className={`${c.chip} ${i < chips ? c.chipOn : ''}`}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className={`${c.signed} ${signed ? c.signedOn : ''}`}>
        <span className={c.tick}>✓</span>
        Signed with your own key. Nothing outside these limits can be bought.
      </div>
      <div className={`${c.float} ${c.floatB}`}>
        <div className={c.floatTitle}>
          <span>Your agent&rsquo;s cart</span>
          <span>2</span>
        </div>
        <div className={c.cartRow}>
          <span>Aero Runner, white, size 10</span>
          <b>$89.00</b>
        </div>
        <div className={c.checkList}>
          <span>✓ Within budget</span>
          <span>✓ Right size and colour</span>
          <span>✓ Arrives in time</span>
        </div>
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
          See how it works
        </a>
      </div>
    );
  }
  return (
    <div className={c.cta}>
      <Link href="/login?mode=sign-up" className={`${c.btn} ${c.btnLg}`}>
        Get started free
      </Link>
      <Link href="/login" className={`${c.btnGhost} ${c.btnLg}`}>
        Sign in
      </Link>
    </div>
  );
}

export default function Landing() {
  const [fill, setFill] = useState(false);
  const meterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = meterRef.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setFill(true);
      return;
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && (setFill(true), io.disconnect()), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={c.page}>
      <ScrollProgress />
      <header className={c.nav}>
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
            <a href="#fair" className={c.navLink}>
              Fair disputes
            </a>
            <a href="#who" className={c.navLink}>
              Who it&rsquo;s for
            </a>
            <NavActions />
          </nav>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className={c.hero}>
          <div className={c.blobs} aria-hidden="true">
            <span className={`${c.blob} ${c.blob1}`} />
            <span className={`${c.blob} ${c.blob2}`} />
            <span className={`${c.blob} ${c.blob3}`} />
          </div>
          <div className={`${c.wrap} ${c.heroGrid}`}>
            <div>
              <span className={c.eyebrow}>AI shopping with proof</span>
              <h1 className={c.h1}>
                Let an AI shop for you. <span className={c.accent}>Keep proof of what you asked.</span>
              </h1>
              <p className={c.lead}>
                Tell your agent what you want and set your limits. MandatePay signs them, checks every cart against them, and
                uses that proof to settle disputes fairly.
              </p>
              <HeroActions />
              <p className={c.note}>Runs on the PayPal sandbox: practice money, no real charges.</p>
            </div>
            <HeroDemo />
          </div>
        </section>

        <Marquee />
        <div className={c.wrap}>
          <Counters />
        </div>

        {/* problem and answer */}
        <section className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>When an AI buys something, who decides it was the right thing?</h2>
              <p className={c.sub}>Today nobody can prove it. That is bad for shoppers and for stores.</p>
            </Reveal>
            <div className={c.split}>
              <Reveal delay={0.05}>
                <div className={`${c.panel} ${c.panelBad}`}>
                  <h3>Without proof</h3>
                  <p>
                    The agent buys the wrong size. The buyer says &ldquo;I never asked for that.&rdquo; The store says &ldquo;you did.&rdquo;
                    PayPal has to guess, and honest people lose.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={0.15}>
                <div className={`${c.panel} ${c.panelGood}`}>
                  <h3>With MandatePay</h3>
                  <p>
                    What you asked for is signed before anything is bought. Each cart is checked against it. If there is a dispute,
                    the signed record settles it in minutes.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className={`${c.section} ${c.sectionAlt}`}>
          <div className={c.wrap}>
            <Reveal className={c.center}>
              <h2 className={c.h2}>How it works</h2>
              <p className={c.sub}>Four steps, and you stay in charge of every one of them.</p>
            </Reveal>
            <div className={c.steps}>
              {[
                ['1', 'Say what you want', 'Type it, or speak it. Budget, size, colour, when you need it.'],
                ['2', 'Sign your limits', 'Your request becomes a signed mandate. It is yours, and you can cancel it any time.'],
                ['3', 'Shop your way', 'Browse the store yourself or let your agent pick. Every cart is checked against your mandate.'],
                ['4', 'Pay with PayPal or card', 'Checkout through PayPal. Something wrong? Report it and the store can refund you directly.'],
              ].map(([n, t, d], i) => (
                <Reveal key={n} delay={i * 0.1}>
                  <div className={c.step}>
                    <div className={c.stepNum}>{n}</div>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className={c.section}>
          <div className={c.wrap}>
            <Reveal className={c.center}>
              <h2 className={c.h2}>Every step leaves a record</h2>
              <p className={c.sub}>From the first request to the final decision, each link in the chain is stored, so a dispute is settled by what happened.</p>
            </Reveal>
            <ProofChain />
          </div>
        </section>

        {/* fair disputes */}
        <section id="fair" className={c.section}>
          <div className={`${c.wrap} ${c.dispute}`}>
            <Reveal>
              <h2 className={c.h2}>Disputes settled with facts, not guesses</h2>
              <p className={c.sub}>
                When a buyer disputes a payment, an AI analyst reads the signed mandate, the cart and the payment, and recommends
                what to do. A person always has the final say.
              </p>
              <ul className={c.bullets}>
                <li>
                  <span className={c.tick}>✓</span>
                  <span>
                    <b>Built from records.</b> The analyst only uses what was signed, ordered and paid, never anyone&rsquo;s word alone.
                  </span>
                </li>
                <li>
                  <span className={c.tick}>✓</span>
                  <span>
                    <b>Safe by design.</b> Code rules block unsafe actions, double refunds and anything the AI is unsure about.
                  </span>
                </li>
                <li>
                  <span className={c.tick}>✓</span>
                  <span>
                    <b>You decide.</b> Nothing is sent to PayPal until a person approves it.
                  </span>
                </li>
              </ul>
            </Reveal>
            <Reveal delay={0.15}>
              <div className={c.verdict} ref={meterRef}>
                <div className={c.verdictHead}>
                  <span>AI recommendation</span>
                  <span className={c.badge}>Person approves</span>
                </div>
                <h4>Send the evidence to the buyer</h4>
                <div className={c.meter} role="img" aria-label="85 percent confidence">
                  <div className={`${c.meterFill} ${fill ? c.meterOn : ''}`} />
                </div>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>85% confident</span>
                <div className={c.proof}>
                  <div className={c.proofRow}>
                    <span className={c.tick}>✓</span> The buyer signed a mandate for white trainers, size 10
                  </div>
                  <div className={c.proofRow}>
                    <span className={c.tick}>✓</span> The cart matched it: within budget, right size
                  </div>
                  <div className={c.proofRow}>
                    <span className={c.tick}>✓</span> Paid from the buyer&rsquo;s own PayPal account
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* who it is for */}
        <section id="who" className={`${c.section} ${c.sectionAlt}`}>
          <div className={c.wrap}>
            <Reveal className={c.center}>
              <h2 className={c.h2}>Made for both sides of the sale</h2>
              <p className={c.sub}>One sign-in. What you see depends on who you are.</p>
            </Reveal>
            <div className={c.cards}>
              <Reveal>
                <div className={c.card}>
                  <h3>If you shop</h3>
                  <p style={{ margin: 0, color: '#475569' }}>Hand the boring part to an agent without giving up control.</p>
                  <ul>
                    <li>Speak or type what you need</li>
                    <li>Browse the store with pictures and prices</li>
                    <li>See your orders and who sold them</li>
                    <li>Report a problem and get a quick refund</li>
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={0.12}>
                <div className={c.card}>
                  <h3>If you run a store</h3>
                  <p style={{ margin: 0, color: '#475569' }}>Sell to people and AI agents with fewer lost disputes.</p>
                  <ul>
                    <li>List products with pictures and stock</li>
                    <li>Get disputes analysed the moment they arrive</li>
                    <li>Send PayPal the proof in one click</li>
                    <li>Track refunds, results and your team</li>
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* trust */}
        <section className={c.section}>
          <div className={c.wrap}>
            <Reveal>
              <div className={c.trust}>
                <div className={c.trustItem}>
                  <b>Signed mandates</b>
                  <span>Your own key, checked every time</span>
                </div>
                <div className={c.trustItem}>
                  <b>PayPal checkout</b>
                  <span>Card details never touch our servers</span>
                </div>
                <div className={c.trustItem}>
                  <b>Humans decide</b>
                  <span>The AI recommends, a person approves</span>
                </div>
                <div className={c.trustItem}>
                  <b>Full audit trail</b>
                  <span>Who did what, and when</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* call to action */}
        <section className={`${c.final} ${c.finalBand}`}>
          <div className={c.wrap}>
            <Reveal>
              <h2 className={c.h2}>Ready to try it?</h2>
              <p className={c.sub} style={{ margin: '0 auto 1.5rem' }}>
                Create an account in a minute, or sign in if you already have one.
              </p>
              <HeroActions />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={c.foot}>
        <div className={c.wrap}>MandatePay · A demo built on the PayPal sandbox. No real money moves.</div>
      </footer>
    </div>
  );
}
