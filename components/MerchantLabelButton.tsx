'use client'

import { PencilLine, X } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import {
  clearMerchantLabelAction,
  setMerchantLabelAction,
} from '@/app/(app)/dashboard/actions'
import type { MerchantLabelState } from '@/app/(app)/dashboard/state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const INITIAL: MerchantLabelState = { error: null, message: null }

/**
 * Give a merchant your own name, matched the way a rule is.
 *
 * A small pencil beside the category chip and the "create rule" wand -- the same
 * "fix it where you read it" cluster. Tapping it opens a modal that reads like a
 * rule: a match type (anything containing / exactly) and a pattern seeded with
 * this row's normalized merchant, plus the name to show. A CONTAINS label
 * covers every charge from the merchant at once -- past instalments, the
 * back-and-forth, and every future sync -- because the one pattern is a
 * substring of all their descriptors.
 *
 * The label is presentational only: it changes the name a row shows and nothing
 * about its category or totals. The original bank descriptor still shows in the
 * detail sheet.
 */
export function MerchantLabelButton({
  merchant,
  currentLabel,
}: {
  /** The row's normalized merchant, or null when its descriptor normalized
   *  away -- then there is no stable text to match a label on. */
  merchant: string | null
  /** The label showing on the row now, or null. Prefills the name field so the
   *  modal edits the existing apelido rather than starting blank. */
  currentLabel: string | null
}) {
  const [open, setOpen] = useState(false)
  const [saveState, saveAction, saving] = useActionState(setMerchantLabelAction, INITIAL)
  const [clearState, clearAction, clearing] = useActionState(clearMerchantLabelAction, INITIAL)

  // Escape closes it, matching the rule modal and the detail sheet, and the
  // listener only exists while the modal is open.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // A save or a clear that succeeded has done its job; close so the row behind,
  // now re-rendered with (or without) the label, is what the household sees.
  const message = saveState.message ?? clearState.message
  useEffect(() => {
    if (message) setOpen(false)
  }, [message])

  const labelled = Boolean(currentLabel)

  // No merchant, nothing to label: a disabled glyph, so the cluster keeps its
  // shape down the column instead of the pencil appearing and vanishing row to
  // row.
  if (!merchant) {
    return (
      <span
        aria-hidden
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-faint opacity-40"
      >
        <PencilLine className="size-4 shrink-0" />
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={labelled ? `Apelido: ${currentLabel}. Clique para editar.` : 'Dar um apelido a este estabelecimento'}
        title={labelled ? `Apelido: ${currentLabel}` : 'Dar um apelido'}
        className={
          // A clean ghost glyph matching the category and wand icons; lit when a
          // label is already set so a named merchant reads down the column.
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ' +
          (labelled
            ? 'text-foreground hover:bg-surface-3'
            : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground')
        }
      >
        <PencilLine className="size-4 shrink-0" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Apelido do estabelecimento"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-popover p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug">Apelido do estabelecimento</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="-mr-1 -mt-1 shrink-0 rounded-md border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              O apelido aparece no lugar da descrição do banco em todos os lançamentos que casam com o
              padrão — os antigos e os que ainda vão chegar. A descrição original continua na tela de
              detalhes.
            </p>

            <form action={saveAction} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Label>
                  Casar
                  {/* CONTAINS by default: a label made from one charge almost
                      always means "and every other charge like it". EXACT pins
                      it to this exact descriptor. Same choice the rule form
                      offers. */}
                  <Select name="matchType" defaultValue="CONTAINS">
                    <option value="CONTAINS">tudo que contém</option>
                    <option value="EXACT">exatamente</option>
                  </Select>
                </Label>
                <Label>
                  Padrão
                  <Input
                    name="pattern"
                    type="text"
                    required
                    defaultValue={merchant}
                    placeholder="ex.: GADERMATOLOGIA"
                  />
                </Label>
              </div>
              <Label>
                Apelido
                <Input
                  name="label"
                  type="text"
                  required
                  defaultValue={currentLabel ?? ''}
                  placeholder="ex.: CCAA"
                  autoFocus
                />
              </Label>

              {saveState.error ? (
                <p role="alert" className="text-sm text-neg">
                  {saveState.error}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : 'Salvar apelido'}
                </Button>
                {/* Remove targets the (match type, pattern) in the form, so it
                    clears exactly the label the fields describe. Only offered
                    when a label is already showing on this row. */}
                {labelled ? (
                  <button
                    type="submit"
                    formAction={clearAction}
                    disabled={clearing}
                    className="text-sm text-neg underline-offset-4 hover:underline disabled:opacity-60"
                  >
                    {clearing ? 'Removendo…' : 'Remover apelido'}
                  </button>
                ) : null}
              </div>
              {clearState.error ? (
                <p role="alert" className="text-sm text-neg">
                  {clearState.error}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
