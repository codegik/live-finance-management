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

/**
 * Connects a new bank, or -- given an itemId -- reopens Pluggy Connect
 * against an existing one to repair a broken consent. Both paths end in the
 * same POST /api/connections, which re-runs attachConnection and syncs.
 */
export function ConnectBankButton({ itemId, label }: { itemId?: string; label?: string } = {}) {
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const response = await fetch('/api/pluggy/connect-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      })
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
      {busy ? 'Opening…' : (label ?? 'Connect a bank')}
    </button>
  )
}
