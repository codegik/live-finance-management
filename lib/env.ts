import { z } from 'zod'

/**
 * Values that are documented placeholders rather than secrets. They live in
 * .env.example, which is committed, so anyone can read them — a deployment
 * running on one has no secret at all. Length alone does not catch this:
 * the old placeholder was 36 characters and sailed past a min(16).
 *
 * Matched case-insensitively and as a prefix, so CHANGE_ME_AUTH_SECRET and
 * similar variations are caught too.
 */
const PLACEHOLDERS = [
  'change_me',
  'generate-with-openssl-rand-base64-32',
  'replace-with-your-pluggy-client-id',
  'replace-with-your-pluggy-client-secret',
  'replace-with-your-resend-api-key',
  'alerts@yourdomain.com',
]

function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase()
  return PLACEHOLDERS.some((p) => v === p || v.startsWith(p))
}

/** A secret that must be long enough AND must not be a published placeholder. */
const secret = (min: number) =>
  z
    .string()
    .min(min)
    .refine((v) => !isPlaceholder(v), {
      message:
        'is a placeholder from .env.example, which is public. Generate a real value: openssl rand -base64 32',
    })

/**
 * Pulls the address out of Resend's `Name <address>` display form, or
 * returns the value unchanged when it is already a bare address.
 */
function senderAddress(value: string): string {
  const match = value.match(/^.*<([^<>]+)>\s*$/)
  return (match ? match[1] : value).trim()
}

/**
 * The verified Resend sending address. `z.string().email()` alone rejects
 * `Alertas <alerts@casa.com.br>` -- the display-name form Resend's own docs
 * show -- and fails the boot with no hint of why, so either form is accepted
 * here. Also subject to the placeholder check: .env.example ships
 * `alerts@yourdomain.com`, a syntactically valid email that is not a secret
 * at all. A deployment that copies it boots clean and then sends from an
 * unverified domain, a failure Resend rejects and the alert code swallows
 * into a console.error -- exactly the "quietly sends nothing" failure the
 * design calls unacceptable.
 */
const alertSender = z
  .string()
  .refine((v) => z.string().email().safeParse(senderAddress(v)).success, {
    message: 'must be an email address, or "Name <email@domain>" as Resend accepts',
  })
  .refine((v) => !isPlaceholder(senderAddress(v)), {
    message:
      'is a placeholder from .env.example, which is public. Set your verified Resend sending address.',
  })

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: secret(16),
  PLUGGY_CLIENT_ID: secret(1),
  PLUGGY_CLIENT_SECRET: secret(1),
  PLUGGY_API_URL: z.string().url().default('https://api.pluggy.ai'),
  PLUGGY_WEBHOOK_TOKEN: secret(16),
  CRON_SECRET: secret(16),
  RESEND_API_KEY: secret(1),
  ALERT_EMAIL_FROM: alertSender,
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source)
}
