import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { requireSessionOrResponse } from '@/lib/auth/guard'
import { getDb } from '@/lib/db/client'
import { connectionByItemId } from '@/lib/db/connections'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { ENV_INCOMPLETE, PLUGGY_AUTH_FAILED, PLUGGY_UNAVAILABLE } from '@/lib/pluggy/connect-errors'

const body = z.object({ itemId: z.string().min(1).optional() })

/**
 * Every failure below used to leave this handler as a thrown error, and Next
 * answers a throw in a route handler with a 500 whose body is ZERO LENGTH.
 * The browser then ran `await response.json()` on those nought bytes and threw
 * "JSON.parse: unexpected end of data" -- so a household with an unfinished
 * .env.local got a JavaScript crash overlay instead of being told what to set.
 *
 * The status stays non-2xx, because the request genuinely failed. What is
 * added is a body naming WHICH failure, so the button has something to say.
 */
function failureResponse(error: unknown): NextResponse {
  // loadEnv() throws when a required variable is missing, or is still one of
  // the placeholders .env.example publishes. Naming the variables is safe --
  // these are names, not values, and .env.example is committed -- and it is
  // the difference between a message the reader can act on and one they
  // cannot. This is the first thing that goes wrong on a fresh checkout.
  if (error instanceof ZodError) {
    const variables = error.issues.map((issue) => issue.path.join('.')).join(', ')
    return NextResponse.json({ error: ENV_INCOMPLETE, detail: variables }, { status: 503 })
  }

  // Credentials that are present and well-formed, and that Pluggy rejects.
  if (error instanceof Error && error.message === PLUGGY_AUTH_FAILED) {
    return NextResponse.json({ error: PLUGGY_AUTH_FAILED }, { status: 503 })
  }

  return NextResponse.json({ error: PLUGGY_UNAVAILABLE }, { status: 502 })
}

export async function POST(request: Request) {
  const guard = await requireSessionOrResponse()
  if (guard.response) return guard.response
  const session = guard.session

  // The button posts an empty body when connecting a new bank, and some
  // callers post nothing at all; neither is an error.
  const parsed = body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  const itemId = parsed.data.itemId

  // An update-mode token reopens an existing bank connection. The item id
  // arrives from the client, so it is proof of nothing: without this check a
  // signed-in user could name any item id and be handed a token for it.
  if (itemId && !(await connectionByItemId(getDb(), session.householdId, itemId))) {
    return NextResponse.json({ error: 'UNKNOWN_CONNECTION' }, { status: 404 })
  }

  // Only the configuration read and the Pluggy call are caught. The database
  // lookup above deliberately stays outside: a failing query is a server
  // error, and dressing it up as "Pluggy is unavailable" would send whoever
  // debugs it to the wrong system.
  try {
    const env = loadEnv()
    const pluggy = createPluggyClient({
      apiUrl: env.PLUGGY_API_URL,
      clientId: env.PLUGGY_CLIENT_ID,
      clientSecret: env.PLUGGY_CLIENT_SECRET,
    })
    return NextResponse.json({ accessToken: await pluggy.createConnectToken(itemId) })
  } catch (error) {
    // The response carries a code, not the cause. The cause is worth keeping,
    // and the server log is the only place it can go.
    //
    // Flattened to a string first, and that is not tidiness. console.error
    // hands the object to util.inspect, and inspecting a zod ZodError throws
    // "Cannot read properties of undefined (reading 'value')" on Node 25 --
    // inside this catch block, which would abort the handler and send back
    // the empty 500 whose JSON.parse crash in the browser is the whole reason
    // this try/catch exists. loadEnv() throws exactly that error type.
    console.error('connect token failed', {
      householdId: session.householdId,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
    return failureResponse(error)
  }
}
