/**
 * The only module that knows Resend exists. Swapping providers rewrites this
 * directory and nothing else -- everything above it depends on `Mailer`.
 *
 * Plain `fetch` rather than the `resend` npm package, exactly as
 * lib/pluggy/client.ts calls Pluggy: one fewer dependency, and an HTTP
 * boundary MSW can intercept honestly in tests.
 */

export type Mail = { to: string[]; subject: string; text: string }

export type Mailer = { send(mail: Mail): Promise<void> }

const RESEND_URL = 'https://api.resend.com/emails'

export function createMailer(config: { apiKey: string; from: string }): Mailer {
  return {
    async send(mail) {
      // No recipients is not an error; it is a household with no users.
      if (mail.to.length === 0) return

      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        }),
      })

      // Throwing is load-bearing: the caller records the alert as fired only
      // after this resolves, so a rejection is what leaves the threshold
      // armed for the next sync to retry.
      if (!response.ok) {
        throw new Error(`RESEND_FAILED:${response.status}:${await response.text()}`)
      }
    },
  }
}
