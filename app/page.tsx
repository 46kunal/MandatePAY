export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>MandatePay</h1>
      <p>Every AI purchase on PayPal comes with proof of what you asked for.</p>
      <ul>
        <li>
          <a href="/buyer">Buyer view</a>
        </li>
        <li>
          <a href="/merchant">Merchant view</a>
        </li>
        <li>
          <a href="/api/health">API health</a>
        </li>
      </ul>
    </main>
  );
}
