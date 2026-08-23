import type { Mail, Mailer } from '@/lib/email/resend'

/**
 * A fake of the outbound PORT, not of the database. It is legitimate exactly
 * because lib/email/ is isolated: tests/email.test.ts proves the real client
 * against the real HTTP shape with MSW, and everything above it depends only
 * on this interface.
 *
 * Do not reach for MSW here instead. Under its default policy an unhandled
 * request passes through to the network, so a test that forgets a handler
 * would post to api.resend.com for real.
 */
export function createRecordingMailer(): {
  mailer: Mailer
  sent: Mail[]
  failNext(): void
} {
  const sent: Mail[] = []
  let failOnce = false

  return {
    sent,
    failNext() {
      failOnce = true
    },
    mailer: {
      async send(mail) {
        if (failOnce) {
          failOnce = false
          throw new Error('RESEND_FAILED:500:simulated')
        }
        sent.push(mail)
      },
    },
  }
}
