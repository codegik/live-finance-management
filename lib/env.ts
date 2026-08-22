import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
  PLUGGY_CLIENT_ID: z.string().min(1),
  PLUGGY_CLIENT_SECRET: z.string().min(1),
  PLUGGY_API_URL: z.string().url().default('https://api.pluggy.ai'),
  PLUGGY_WEBHOOK_TOKEN: z.string().min(16),
  CRON_SECRET: z.string().min(16),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source)
}
