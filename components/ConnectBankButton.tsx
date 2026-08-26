'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ATTACH_FAILED_MESSAGE,
  connectTokenErrorMessage,
  NETWORK_ERROR_MESSAGE,
  WIDGET_MISSING_MESSAGE,
} from '@/lib/pluggy/connect-errors'

declare global {
  interface Window {
    PluggyConnect?: new (options: {
      connectToken: string
      onSuccess: (data: { item: { id: string } }) => void
    }) => { init: () => void }
  }
}

/**
 * Reads a response body without assuming it is JSON.
 *
 * `await response.json()` on a failed request is what produced the
 * "JSON.parse: unexpected end of data" overlay: a route handler that throws
 * comes back as a 500 with an EMPTY body, and json() parses those nought
 * bytes and throws a SyntaxError naming neither the request nor the cause.
 * Reading the text first means a body that is empty, HTML from a proxy, or
 * anything else non-JSON degrades to "no detail" -- which the caller can
 * still turn into a sentence -- instead of crashing the page.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * Connects a new bank, or -- given an itemId -- reopens Pluggy Connect
 * against an existing one to repair a broken consent. Both paths end in the
 * same POST /api/connections, which re-runs attachConnection and syncs.
 *
 * Every way this can fail ends at the same `error` line beneath the button.
 * None of them may reach the Next.js error overlay: a household that has not
 * finished setting up Pluggy is the ordinary first-run case, not a crash.
 */
export function ConnectBankButton({
  itemId,
  label,
  variant = 'default',
  size = 'default',
}: {
  itemId?: string
  label?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm'
} = {}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/pluggy/connect-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      })
      const parsed = await readJsonBody(response)

      if (!response.ok) {
        setError(connectTokenErrorMessage(response.status, parsed))
        return
      }

      // A 200 is not a promise that the shape is right. Checking here keeps a
      // malformed body out of the widget, which would otherwise open and fail
      // against `connectToken: undefined` with nothing on screen to explain it.
      const accessToken =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { accessToken?: unknown }).accessToken
          : undefined
      if (typeof accessToken !== 'string' || !accessToken) {
        setError(connectTokenErrorMessage(response.status, null))
        return
      }

      if (!window.PluggyConnect) {
        setError(WIDGET_MISSING_MESSAGE)
        return
      }

      new window.PluggyConnect({
        connectToken: accessToken,
        onSuccess: async ({ item }) => {
          const attached = await fetch('/api/connections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ itemId: item.id }),
          }).catch(() => null)

          // Reloading regardless would redraw the screen unchanged, which
          // reads as "nothing happened" -- and the bank IS authorised at
          // Pluggy by now, so the household would connect it a second time.
          if (!attached?.ok) {
            setError(ATTACH_FAILED_MESSAGE)
            return
          }
          window.location.reload()
        },
      }).init()
    } catch {
      // fetch rejecting rather than answering: offline, or the server went
      // away mid-request.
      setError(NETWORK_ERROR_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant={variant} size={size} onClick={connect} disabled={busy}>
        {busy ? 'Opening…' : (label ?? 'Connect a bank')}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
