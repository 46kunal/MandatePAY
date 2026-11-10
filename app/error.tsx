'use client';
// Shown when a page crashes. The message is generic on purpose: details stay in the server logs.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 520, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Something went wrong</h1>
      <p>The page hit an error. Nothing was lost: try again, and if it keeps happening, tell the store.</p>
      {error.digest && <p style={{ color: '#667' }}>Reference: {error.digest}</p>}
      <button onClick={reset}>Try again</button>
    </main>
  );
}
