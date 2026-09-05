import { z } from 'zod'

export type ConnectionState = { error: string | null; message: string | null }

// Postgres throws 22P02 (not merely an empty result) when a non-UUID string
// reaches `eq(<uuid column>, value)`. Validating the shape here, before any
// of these ids reach the db layer, is what turns a hand-edited URL or form
// field into "no such thing" instead of a 500 / thrown rejection.
export const idSchema = z.string().uuid()

export const REMOVED_MESSAGE = 'Connection removed.'
export const UNKNOWN_CONNECTION_ERROR = 'That connection no longer exists.'
export const INVALID_DAY_ERROR = 'A day has to be between 1 and 31.'
export const UNKNOWN_ACCOUNT_ERROR = 'That account no longer exists.'

/** The bank pulled fresh data, or at least re-read what Pluggy already held. */
export const REFRESHED_MESSAGE =
  'Atualização solicitada. Os lançamentos mais recentes chegam em alguns instantes.'
/**
 * The forced bank refresh was refused -- Pluggy allows it about once an hour --
 * but the current data was re-read and re-filed anyway, so the button still did
 * something rather than appearing to fail.
 */
export const REFRESH_THROTTLED_MESSAGE =
  'Dados atualizados. Uma nova busca no banco só pode ser forçada a cada hora.'
export const REFRESH_FAILED_ERROR = 'Não foi possível atualizar agora. Tente de novo em instantes.'
