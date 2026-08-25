/**
 * The vocabulary POST /api/pluggy/connect-token answers a failure with, and
 * the line the household reads for each one.
 *
 * The two halves live in one module because they are only correct together: a
 * code the route emits and the button has no line for falls back to a bare
 * status number, which is precisely the unreadable failure this exists to
 * remove. Nothing here imports zod or touches the request -- the button is a
 * client component, and this has to be safe to pull into its bundle.
 */

export const ENV_INCOMPLETE = 'ENV_INCOMPLETE'
export const PLUGGY_AUTH_FAILED = 'PLUGGY_AUTH_FAILED'
export const PLUGGY_UNAVAILABLE = 'PLUGGY_UNAVAILABLE'

/**
 * Named in the ENV_INCOMPLETE line when the route could not say which
 * variables are wrong. Anyone hitting that message on a fresh checkout is
 * missing exactly these two: ./start.sh writes them as placeholders and warns
 * that connecting a bank fails until they are replaced.
 */
const PLUGGY_VARS = 'PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET'

const MESSAGES: Record<string, string> = {
  [PLUGGY_AUTH_FAILED]:
    'A Pluggy recusou as credenciais deste aplicativo. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET em .env.local — os valores de exemplo do .env.example não funcionam. Veja PLUGGY_SETUP.md.',
  [PLUGGY_UNAVAILABLE]:
    'Não foi possível falar com a Pluggy agora. Tente de novo em alguns minutos.',
  UNAUTHORIZED: 'Sua sessão expirou. Entre novamente para conectar um banco.',
  UNKNOWN_CONNECTION: 'Esta conexão não existe mais. Atualize a página.',
  INVALID_BODY: 'Não foi possível iniciar a conexão com o banco. Atualize a página e tente de novo.',
}

/** Shown when fetch itself rejects: no network, or the server is restarting. */
export const NETWORK_ERROR_MESSAGE =
  'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.'

/** The CDN script that opens the Pluggy widget did not load. */
export const WIDGET_MISSING_MESSAGE =
  'O Pluggy Connect não carregou. Verifique sua conexão e atualize a página.'

/**
 * The bank is linked at Pluggy but POST /api/connections did not store it.
 * Reloading here would show the screen unchanged, which reads as "nothing
 * happened" -- and the household would connect the same bank again.
 */
export const ATTACH_FAILED_MESSAGE =
  'O banco foi autorizado, mas não foi possível salvá-lo aqui. Atualize a página; se ele não aparecer, conecte de novo.'

/**
 * Turns a failed /connect-token response into the line the button renders.
 *
 * `body` is whatever could be parsed out of the response, INCLUDING null: an
 * empty body is a real case (Next answers an unhandled throw in a route
 * handler with a zero-length 500), and the whole point is that it produces a
 * sentence rather than a JSON.parse crash.
 */
export function connectTokenErrorMessage(status: number, body: unknown): string {
  const parsed = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const code = typeof parsed.error === 'string' ? parsed.error : null

  if (code === ENV_INCOMPLETE) {
    // .env.example, not PLUGGY_SETUP.md: the route reports whichever
    // variables loadEnv() rejected, and they are not always the Pluggy ones.
    // .env.example documents every one of them.
    const detail = typeof parsed.detail === 'string' && parsed.detail ? parsed.detail : PLUGGY_VARS
    return `Configuração incompleta: falta definir ${detail} em .env.local. Veja .env.example.`
  }

  // The status is in the fallback on purpose. It is the only thing left to go
  // on when the server answered something this build has no code for, and it
  // is what makes the report actionable instead of "it didn't work".
  return (code && MESSAGES[code]) || `Não foi possível conectar o banco (erro ${status}).`
}
