'use client'

import { useEffect } from 'react'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Game screen error', error) }, [error])
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black p-6 text-white">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p>Your saved progress is retained. Try reopening the game.</p>
      <button className="rounded bg-red-600 px-6 py-3 font-bold" onClick={reset}>TRY AGAIN</button>
    </main>
  )
}
