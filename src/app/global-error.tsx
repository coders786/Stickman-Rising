'use client'

/** ROOT-LEVEL CRASH NET.
 *
 *  `app/error.tsx` catches a failure inside the page segment. This one catches a
 *  failure in the ROOT LAYOUT or in hydration itself — the class of bug where the
 *  whole document fails and the player gets a white page with a console trace
 *  they will never read.
 *
 *  It deliberately does not try to be clever: no state, no effects beyond the log,
 *  no localStorage (storage may be exactly what failed). One message, one way
 *  out. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  if (typeof console !== 'undefined') console.error('Root error', error)
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#000', color: '#fff', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '0.2em' }}>STICKMAN RISING</h1>
          <p style={{ fontSize: 14, opacity: 0.75, maxWidth: 420 }}>
            The game failed to start. Saved progress is kept in this browser.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={reset}
              style={{ background: '#dc2626', color: '#fff', border: 0, padding: '12px 24px', fontWeight: 800, letterSpacing: '0.15em', cursor: 'pointer' }}
            >
              RETRY
            </button>
            <button
              onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
              style={{ background: 'transparent', color: '#d4d4d8', border: '1px solid #3f3f46', padding: '12px 24px', fontWeight: 800, letterSpacing: '0.15em', cursor: 'pointer' }}
            >
              RELOAD
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
