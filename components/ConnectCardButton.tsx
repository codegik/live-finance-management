'use client'

import { useState } from 'react'

declare global {
  interface Window {
    PluggyConnect?: new (options: {
      connectToken: string
      onSuccess: (data: { item: { id: string } }) => void
    }) => { init: () => void }
  }
}

export function ConnectCardButton() {
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const response = await fetch('/api/pluggy/connect-token', { method: 'POST' })
      const { accessToken } = (await response.json()) as { accessToken: string }

      if (!window.PluggyConnect) throw new Error('Pluggy Connect script not loaded')

      new window.PluggyConnect({
        connectToken: accessToken,
        onSuccess: async ({ item }) => {
          await fetch('/api/connections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ itemId: item.id }),
          })
          window.location.reload()
        },
      }).init()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={connect} disabled={busy}>
      {busy ? 'Opening…' : 'Connect a card'}
    </button>
  )
}
