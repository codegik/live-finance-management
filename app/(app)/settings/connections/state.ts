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
