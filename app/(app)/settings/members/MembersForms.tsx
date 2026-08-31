'use client'

import { useActionState, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createInviteAction, revokeInviteAction } from './actions'
import { INVITE_INITIAL, type InviteState, REVOKE_INITIAL } from './state'

/**
 * The join link is only ever a relative path server-side -- the server does not
 * know which host the household reaches it on. The absolute link a person can
 * actually paste into a browser is built here, in the browser, from the origin
 * the inviter is already looking at.
 */
function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

function InviteLink({ state }: { state: InviteState }) {
  const [copied, setCopied] = useState(false)
  const url = state.inviteUrl ? absoluteUrl(state.inviteUrl) : null

  // A fresh invite is a new link; the "Copiado" flag from the last one must not
  // linger on it.
  useEffect(() => setCopied(false), [state.inviteUrl])

  if (!url) return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/50 p-3">
      <p className="text-xs text-muted-foreground">
        Convite criado. Envie este link — ele funciona uma vez e pede a senha de quem entrar.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={url} aria-label="Link do convite" className="sm:flex-1 font-mono" />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  )
}

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInviteAction, INVITE_INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Label className="sm:flex-1">
          Nome
          <Input name="name" type="text" required placeholder="ex.: Ana" aria-label="Nome" />
        </Label>
        <Label className="sm:flex-1">
          E-mail
          <Input
            name="email"
            type="email"
            required
            placeholder="ana@exemplo.com"
            aria-label="E-mail"
          />
        </Label>
      </div>
      <div className="flex items-center justify-between gap-3">
        {state.error ? (
          <p role="alert" className="text-sm text-neg">
            {state.error}
          </p>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Gerando…' : 'Gerar convite'}
        </Button>
      </div>
      <InviteLink state={state} />
    </form>
  )
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState(revokeInviteAction, REVOKE_INITIAL)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      {state.error ? (
        <span role="alert" className="text-xs text-neg">
          {state.error}
        </span>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={pending}
      >
        {pending ? 'Cancelando…' : 'Cancelar'}
      </Button>
    </form>
  )
}
