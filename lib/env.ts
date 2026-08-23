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

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: secret(16),
  PLUGGY_CLIENT_ID: secret(1),
  PLUGGY_CLIENT_SECRET: secret(1),
  PLUGGY_API_URL: z.string().url().default('https://api.pluggy.ai'),
  PLUGGY_WEBHOOK_TOKEN: secret(16),
  CRON_SECRET: secret(16),
  RESEND_API_KEY: secret(1),
  ALERT_EMAIL_FROM: z.string().email(),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source)
}
