export type InviteState = {
  error: string | null
  /** The relative join path (`/join/<token>`) of the invite just created. */
  inviteUrl: string | null
}

export type RevokeState = { error: string | null; message: string | null }

export const INVITE_INITIAL: InviteState = { error: null, inviteUrl: null }
export const REVOKE_INITIAL: RevokeState = { error: null, message: null }

export const EMPTY_FIELDS_ERROR = 'Informe um nome e um e-mail.'
export const INVALID_EMAIL_ERROR = 'Esse e-mail não parece válido.'
export const EMAIL_IN_USE_ERROR = 'Esse e-mail já pertence a alguém da casa.'
export const REVOKED_MESSAGE = 'Convite cancelado.'
export const UNKNOWN_INVITE_ERROR = 'Esse convite não existe mais.'
