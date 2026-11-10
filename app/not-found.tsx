import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 520, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Page not found</h1>
      <p>That page does not exist, or you may not have access to it.</p>
      <p>
        <Link href="/">Back to MandatePay</Link>
      </p>
    </main>
  );
}
