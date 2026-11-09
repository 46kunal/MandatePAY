import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>MandatePay</h1>
      <p>Every AI purchase on PayPal comes with proof of what you asked for.</p>
      <ul>
        <li>
          <Link href="/buyer">Shop with your agent</Link> (sign in or create an account)
        </li>
        <li>
          <Link href="/merchant">Store dashboard</Link> (store team sign-in)
        </li>
      </ul>
    </main>
  );
}
