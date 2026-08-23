# Pluggy API Setup Guide

How to obtain `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` for this app.

Researched against Pluggy's official documentation on **2026-08-22**. Every claim below links to
its source. Anything I could not confirm from an official page is tagged **⚠️ unverified**.

---

## TL;DR

- **Yes, signup is self-serve.** Create an account at <https://dashboard.pluggy.ai/> — no sales
  call, no credit card, no commercial agreement needed to get credentials.
- **For your use case (your own cards, personal household app) there is a permanently free
  path**: connect your banks at <https://meu.pluggy.ai/>, then read them through the API via the
  **MeuPluggy connector** using a Dashboard application's `CLIENT_ID`/`CLIENT_SECRET`. Pluggy
  states this is "gratuito por tempo indeterminado" (free, indefinitely).
- The 14/15-day Dashboard trial only gates the **commercial** flow (connecting other people's
  accounts directly). Personal use keeps working after it ends.
- **Yes, there is a sandbox** — the "Pluggy Bank" connector, same host, same credentials, with
  published fake logins (`user-ok` / `password-ok` / MFA `123456`).
- `PLUGGY_API_URL=https://api.pluggy.ai` is correct, and is the **only** host. There is no
  separate sandbox host.
- **On the `date` field: the docs do not definitively answer it.** See
  [§8](#8-the-date-field-on-transactions-read-this-before-bucketing-by-day) — this matters for
  your São Paulo day bucketing and you should verify it empirically before trusting either
  interpretation.

---

## 1. Sign-up path — start here

### The commercial / standard path

1. Go to **<https://dashboard.pluggy.ai/>** and sign up (Auth0-backed login; email + password or
   social). Signing up also creates a **Team**.
2. Go to the **Applications** tab — **<https://dashboard.pluggy.ai/applications>**.
3. Create your first Application.
4. > "Once created, you'll receive a pair of `CLIENT_ID` and `CLIENT_SECRET` credentials."
   > — [Get your API keys](https://docs.pluggy.ai/docs/get-your-api-keys)

This is fully **self-serve**. Nothing in the docs requires contacting sales to obtain
credentials. You get a **free trial in production** on signup:

> "Ao criar uma conta no Dashboard da Pluggy, você tem acesso completo à API por 14 dias sem
> precisar de cartão de crédito."
> — [Planos e Preços](https://www.pluggy.ai/precos)

**⚠️ Source conflict on trial length.** The pricing page says **14 days**; the Meu Pluggy
landing page and the `meu-pluggy` GitHub README both say **15 days**. Treat it as "about two
weeks" and don't build anything that depends on the exact number.

### The path you actually want: Meu Pluggy (free forever, personal use)

Pluggy explicitly supports "I just want to read my own bank data into my own app" as a free,
non-expiring flow. Source: <https://www.pluggy.ai/meu-pluggy> and
<https://github.com/pluggyai/meu-pluggy>.

The official step-by-step (translated from <https://www.pluggy.ai/meu-pluggy>):

1. Create an account at **<https://meu.pluggy.ai/>** (email + password).
2. Inside Meu Pluggy, click **"Conectar Minha Conta"** and add each bank/card you want to
   track. Repeat per institution.
3. Create an account at **<https://dashboard.pluggy.ai/>**.
4. Create **one** Application in the Dashboard. All your Meu Pluggy accounts live under it.
5. Copy the **Client ID** and **Client Secret** from that Application.
6. **In the Dashboard, open the Application, choose the `MeuPluggy` connector, log in with your
   Meu Pluggy account and authorize access.** Repeat once per connected *bank* (not per
   account).
7. Done — balances, accounts and transactions are readable through the API.

Pluggy's own caveats on this flow, quoted:

> "O Meu Pluggy e o acesso à API através dele são gratuitos por tempo indeterminado, sem prazo
> de expiração."

> "O Dashboard abre com um teste de 15 dias, mas isso vale só para os recursos de uso comercial.
> Para uso pessoal, o prazo não muda nada: passados os 15 dias, você continua acessando o Meu
> Pluggy e o Dashboard normalmente, sem interrupção e sem custo."

> "Toda vez que você conectar uma conta nova no Meu Pluggy, precisa repetir o **Passo 6** para
> vinculá-la à sua aplicação no Dashboard."

> "Existe limite de contas que posso conectar no Meu Pluggy? **Não**, desde que todas as contas
> sejam suas, nominais."

> "Posso usar essa API para fins comerciais? **Não.** Uso comercial exige o plano pago da
> Pluggy."

Pluggy's pricing FAQ calls this the **"Conector 200"** (a free proxy over your Meu Pluggy data)
and is candid about the trade-offs — no SLA, no contract, three-step onboarding, no PIX /
webhooks / categorization / KYC, and **data is not portable** if you later migrate to a paid
plan. For a personal household app those are all acceptable.

**⚠️ unverified:** the numeric connector id `200` appears only in the marketing FAQ prose, not
in the API reference. Don't hardcode it — resolve it at runtime from `GET /connectors`
(look for the connector named `MeuPluggy`).

### Sync cadence caveat

The `meu-pluggy` README notes the proxy authorization "will refresh the information on a daily
basis." **⚠️ unverified** whether you can force a more frequent refresh on the free flow.

---

## 2. Where the credentials live

**Dashboard → Applications → (your application)**

- Direct link: **<https://dashboard.pluggy.ai/applications>**
- Sources: [Get your API keys](https://docs.pluggy.ai/docs/get-your-api-keys);
  [Quickstart README](https://github.com/pluggyai/quickstart) ("Create an application to get
  your **Client ID** and **Client Secret**").

The `CLIENT_ID` is a **UUID** (`"format": "uuid"` in the OpenAPI spec); the `CLIENT_SECRET` is an
opaque string.

> "These credentials will give access to users' financial data, so it's essential to take all
> possible measures to store them safely, and never share them publicly."

API keys minted from these can be **revoked from the Dashboard**, and you can then mint fresh
ones.

```bash
# .env
PLUGGY_CLIENT_ID=f8c9b8f0-b8e2-4f0f-b8e2-4f0f8e2f0f8e2   # example shape from the OpenAPI spec
PLUGGY_CLIENT_SECRET=UZzp2n7eMThpfZ74Xf7                  # example shape from the OpenAPI spec
PLUGGY_API_URL=https://api.pluggy.ai
```

---

## 3. Sandbox vs production

**There is no separate sandbox environment, host, or credential set.** Sandbox is a *connector*
inside the production API.

> "Using our production environment you can access `Live` and `Sandbox` connectors. For testing
> purposes, you can experiment with your integration using our **Sandbox connector** (which
> represents our `Sandbox` environment)."
> — [Sandbox](https://docs.pluggy.ai/docs/sandbox)

| Question | Answer | Source |
|---|---|---|
| Separate sandbox host? | **No.** The OpenAPI spec declares exactly one server: `https://api.pluggy.ai` | [Create API Key OpenAPI](https://docs.pluggy.ai/reference/auth-create) |
| Separate sandbox credentials? | **No.** Same `CLIENT_ID`/`CLIENT_SECRET` | [Sandbox](https://docs.pluggy.ai/docs/sandbox) |
| Is `https://api.pluggy.ai` right for both? | **Yes** | same |
| How do I see sandbox connectors? | `GET /connectors?sandbox=true` — *"Include sandbox connectors if set to true (default: false)"*; each connector carries an `isSandbox` boolean | [List connectors](https://docs.pluggy.ai/reference/connectors-list) |
| How do I see them in the widget? | Pass `includeSandbox: true` to `PluggyConnect` — *"Whether to display Sandbox connectors in the Connector selection step (not intended for production use)"* | [Environments and configurations](https://docs.pluggy.ai/docs/environments-and-configurations) |

⚠️ **Sandbox items expire:**

> "All the sandbox items that are not updated for more than **30 days** will be deleted without
> any possibility to get in the future"

---

## 4. Sandbox test connectors and credentials

The sandbox connector is called **"Pluggy Bank"**. All credentials below are published verbatim
in [docs.pluggy.ai/docs/sandbox](https://docs.pluggy.ai/docs/sandbox).

**⚠️ unverified:** the numeric connector id for Pluggy Bank is not stated in the docs. Resolve it
with `GET /connectors?sandbox=true`.

### The happy path

| Field | Value |
|---|---|
| Username | `user-ok` |
| Password | `password-ok` |
| MFA token (when prompted) | `123456` |

> "For a successful flow, the credentials are: **Correct password**: `password-ok` / **Correct
> MFA Token**: `123456`"

Any username other than the listed ones returns `INVALID_CREDENTIALS`.

### Error / edge-case usernames (password stays `password-ok`)

| Execution status | Username |
|---|---|
| `SUCCESS` | `user-ok` |
| `ALREADY_LOGGED_IN` | `user-logged` |
| `ACCOUNT_LOCKED` | `user-locked` |
| `UNEXPECTED_ERROR` | `user-error` |
| `SITE_NOT_AVAILABLE` | `user-unavailable` |
| `ACCOUNT_NEEDS_ACTION` | `user-account-need-actions` |
| `ACCOUNT_NEEDS_ACTION` + `providerMessage` | `user-account-need-actions-provider-message` |
| `CONNECTION_ERROR` | `user-connection-error` |
| `ACCOUNT_CREDENTIALS_RESET` | `user-account-credentials-reset` |
| `USER_NOT_SUPPORTED` | `user-not-supported` |
| `PARTIAL_SUCCESS` (account product error) | `user-ok-account-error` |
| `SUCCESS` with warnings | `user-ok-account-warning` |
| `SUCCESS` with two checking accounts | `user-ok-two-checking-accounts` |
| `USER_AUTHORIZATION_PENDING` (Caixa-style flow) | `user-ok-auth-pending` |
| MFA image challenge | `user-ok-img` |
| MFA select challenge | `user-ok-select` |
| MFA phone challenge | `user-ok-phone` |
| Multi-company | `user-ok-multi-company` |

**Bulk transactions for perf testing:** `user-ok-perf` or `user-ok-perf-XXx`, where `XX` is a
multiplier (e.g. `user-ok-perf-1000x`). Multiplier is capped at 5000.

### Does the sandbox give you a credit card? Yes.

The Sandbox item always returns at least one `BANK`/`CHECKING_ACCOUNT` **and** one
`CREDIT`/`CREDIT_CARD` account. The documented credit-card shape:

```json
{
  "type": "CREDIT", "subtype": "CREDIT_CARD",
  "balance": -503.1,
  "creditData": {
    "level": "BLACK", "brand": "MASTERCARD",
    "balanceCloseDate": "2026-07-23", "balanceDueDate": "2026-07-28",
    "creditLimit": 300000, "availableCreditLimit": 300000,
    "minimumPayment": 100.62, "holderType": "MAIN", "status": "ACTIVE"
  }
}
```

The docs say the sandbox card returns 9 transactions, all purchases, exactly one of which has
`creditCardMetadata` populated (an installment purchase). No disputes, refunds, or cash
advances are simulated. Pluggy also warns:

> "The values above are illustrative examples of what the Sandbox can return... The Sandbox is
> not intended to be used as a target for automated tests that assert on Pluggy's specific
> behavior."

---

## 5. Cost and limits

Source: <https://www.pluggy.ai/precos>

| | Meu Pluggy / "Conector 200" | Dashboard trial | Paid "Dados" |
|---|---|---|---|
| Price | **Free, indefinitely** | Free | **From R$ 2.500/month** |
| Duration | No expiry | 14 days (⚠️ 15 on other pages) | Monthly |
| Credit card required | No | No | Yes |
| Account limit | **None**, as long as every account is yours | ⚠️ not published | Volume-based |
| Commercial use | **Not allowed** | Allowed | Allowed |
| Onboarding | Via meu.pluggy.ai, then authorize per bank | In your product | In your product |
| Webhooks / categorization / PIX / KYC | **Not included** | Included | Included |

Notes:

- Paid "Pagamentos" (PIX) is a separate product from **R$ 500/month**.
- "Cada chamada de leitura à API (saldo, transação, investimento) conta como uma requisição."
  No published request quota for the free personal flow — **⚠️ unverified**; assume you should
  be polite (poll daily, not per-minute). See
  [Operational Rate Limits](https://docs.pluggy.ai/docs/operational-rate-limits).
- What happens after the trial: *"As conexões com contas reais de clientes pausam até você
  ativar um plano. Sua configuração e seus dados ficam guardados por 30 dias. Se quiser
  continuar acessando apenas seus próprios dados bancários via API (uso pessoal), é possível
  fazer isso gratuitamente via Conector 200."*
- Transaction history depth: the API reference describes the transactions product as
  *"Retrieve up to 12 months of transaction data."*

---

## 6. The auth model — your understanding is correct

Confirmed against [Authentication](https://docs.pluggy.ai/docs/authentication) and the OpenAPI
specs.

```
CLIENT_ID + CLIENT_SECRET   (server-side secret, never leaves your backend)
        │
        │  POST https://api.pluggy.ai/auth
        │  { "clientId": "...", "clientSecret": "..." }
        ▼
   apiKey   →  response is { "apiKey": "<jwt>" },   valid 2 HOURS
        │
        │  POST https://api.pluggy.ai/connect_token
        │  header: X-API-KEY: <apiKey>
        │  body:   { "options": { "clientUserId": "...", "webhookUrl": "..." } }   (optional)
        ▼
   accessToken  →  response is { "accessToken": "<jwt>" },  valid 30 MINUTES
        │
        └──► hand to the browser, pass to PluggyConnect as `connectToken`
```

Exact facts:

- Auth header everywhere is **`X-API-KEY`** (from the OpenAPI `securitySchemes`), not
  `Authorization: Bearer`.
- **`POST /auth`** request body keys are **`clientId`** / **`clientSecret`** (camelCase).
  Response key is **`apiKey`**.
- > "This API key expires after 2 hours and will give you full access to all Pluggy API
  > endpoints."
- **`POST /connect_token`** response key is **`accessToken`** (not `connectToken`).
- > "The `connectToken` is valid for 30 minutes only. The recommended usage is 1-per-connection,
  > so we suggest creating a new one, each time you want to create or update an Item."
- Connect tokens are deliberately crippled: read-only access to `GET /items/:id` and a reduced
  `GET /accounts?itemId`. Anything else →
  > "Attempts of accessing detailed products data using a Connect Token (instead of an API Key)
  > will result in a `403 Forbidden` API response."

**Practical implication for your app:** cache the `apiKey` server-side with a TTL shorter than 2
hours (e.g. refresh at 100 minutes or on the first 401/403), and mint a **fresh** connect token
on every widget open rather than caching it.

Useful `connect_token` options (`ItemOptions`, documented verbatim):

```json
{
  "webhookUrl": "https://example.com/webhook",
  "clientUserId": "My App UserId",
  "oauthRedirectUri": "https://pluggy.ai/demo",
  "avoidDuplicates": true
}
```

---

## 7. Pluggy Connect widget

The current officially documented integrations
([Setup PluggyConnect Widget on your app](https://docs.pluggy.ai/docs/setup-pluggyconnect-widget-on-your-app),
[quickstart repo](https://github.com/pluggyai/quickstart)):

**Plain script tag (what the official HTML quickstart uses):**

```html
<script src="https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js"></script>
```

- `https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js` — verified 200 on 2026-08-22.
- Pinned versions work too: the official quickstart pins
  `https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js` (verified 200).
- **⚠️ unverified:** which pinned version is newest. I probed several higher version numbers and
  got 404s, so don't guess a tag — either use `latest` or copy whatever version the
  [quickstart](https://github.com/pluggyai/quickstart/blob/master/frontend/html/index.html)
  currently pins.

**npm packages** (versions checked against the npm registry on 2026-08-22):

| Package | Latest | Use |
|---|---|---|
| [`pluggy-connect-sdk`](https://www.npmjs.com/package/pluggy-connect-sdk) | `2.14.2` | Plain JS/TS wrapper for the widget |
| [`react-pluggy-connect`](https://www.npmjs.com/package/react-pluggy-connect) | `2.12.0` | React bindings |
| [`pluggy-sdk`](https://www.npmjs.com/package/pluggy-sdk) | `0.90.0` | **Server-side** Node SDK (auth, items, transactions) |

**Does it need anything beyond a connect token? No.** That is the entire required input:

> "If you are using our Pluggy Connect widget, you'll only need to take care of providing the
> Connect Token - the rest will be handled by us."

Minimal working example, taken from the official quickstart:

```html
<script src="https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js"></script>
<script>
  fetch('/api/token', { method: 'POST' })          // your backend mints the connect token
    .then((r) => r.json())
    .then(({ accessToken }) => {
      const pluggyConnect = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: true,                      // set false in production
        onSuccess: (itemData) => console.log('connected', itemData.item.id),
        onError: (error) => console.error(error),
      })
      pluggyConnect.init()
    })
</script>
```

Other documented options include `connectorIds` (restrict which institutions are offered),
`connectorTypes`, widget language, and `updateItem` for re-authenticating an existing item. See
[Environments and configurations](https://docs.pluggy.ai/docs/environments-and-configurations).

Capture the `itemId` from `onSuccess` (or from a webhook) and persist it — that's your handle
for all subsequent server-side reads.

---

## 8. The `date` field on transactions — read this before bucketing by day

**Confidence: the documentation does NOT definitively answer this.** I am flagging it rather
than guessing, because guessing here shifts every transaction by a day.

### What the docs actually say — verbatim

From the field table on
**[docs.pluggy.ai/docs/transactions](https://docs.pluggy.ai/docs/transactions)**:

> **date** — *date* — "Posted date of the transaction, formatted in ISO8601 (UTC time). If it is
> necessary to interpret it as Brazilian time, you will need to convert it to GMT-3."

From the OpenAPI schema
([`GET /v2/transactions`](https://docs.pluggy.ai/reference/transactions-list-by-cursor)):

```json
"date": {
  "type": "string",
  "format": "date-time",
  "description": "Date when the transaction was made"
}
```

That is the entirety of what Pluggy documents about this field. **There is no statement about
whether the time component is real, no per-connector table for it, and no mention anywhere of a
credit-card vs checking-account difference.** I searched the transactions guide, the transaction
OpenAPI schema, the Credit Cards coverage page, the Credit Card Bills page, the Credit Card
Installments page, and the Open Finance considerations/FAQ page. None address it.

### What the examples suggest

**Every ordinary example in the docs is midnight-padded UTC:**

- Transactions guide sample response: `"date": "2021-04-12T00:00:00.000Z"`
- `GET /v2/transactions` OpenAPI example: `"date": "2020-10-15T00:00:00.000Z"`
- Credit Card Bills: `"dueDate": "2023-09-15T00:00:00.000Z"`, `"paymentDate": "2023-09-15T00:00:00.000Z"`

**The one place real times appear** is the *End-of-Day Balance* section of the transactions
guide, which shows `2024-10-04T18:00:00.000Z` and `2024-10-04T10:00:00.000Z` — and that section
carries an explicit scope limit:

> "This is only supported by Pluggy's Direct connectors (Itau PJ, Sicredi PJ, Bradesco PJ, Inter
> PJ, Banrisul PJ, Santander PJ)."

Corroborating signals that the field is treated as a calendar date:

- The date filters are documented as calendar dates: `dateFrom` / `dateTo` — *"Filter
  transactions with date greater than or equal to the given date. **Format (yyyy-mm-dd)**"*,
  with example `"2020-10-13"`.
- The cursor pagination token in the OpenAPI example base64-decodes to
  `2020-10-15T00:00:00.000Z|a8534c85-53ce-4f21-94d7-50e9d2ee4957` — a midnight-padded value used
  as a sort key.
- The `pluggy-sdk` TypeScript type is simply `date: Date` with the comment *"Date of the
  transaction that was made."*

### My reading — **⚠️ inference, not documented**

Most likely: **time-of-day is connector-dependent, and for retail (PF) / Open Finance connectors
— which is what the MeuPluggy proxy will give you for your credit cards — the value is a
calendar date padded to `T00:00:00.000Z`.** Real times appear to be limited to a handful of
direct PJ connectors. I have **not** found an official statement confirming this, and I have not
found any per-connector documentation of it.

### Why this is dangerous for your app

If `date` is `2026-08-01T00:00:00.000Z` and you convert it to `America/Sao_Paulo` (UTC−3), you
get **2026-07-31 21:00** — the transaction lands in the *previous* São Paulo calendar day. The
docs' own advice ("convert it to GMT-3") is actively harmful when the value is midnight-padded,
because it was written for the case where the time component is meaningful.

Two possible correct behaviours, and they are mutually exclusive:

- **If midnight-padded:** bucket by the **UTC calendar date** — literally `date.slice(0, 10)`.
  Do *not* timezone-convert.
- **If real local time:** convert to `America/Sao_Paulo` first, then take the calendar date.

⚠️ There is also an open question I could not resolve: if the value *is* midnight-padded, the
docs do not say whether the pad is midnight-UTC of the *institution's local* posting date (so
`slice(0,10)` is right) or midnight-local rendered in UTC. The consistent `T00:00:00.000Z`
suffix in every example points to the former, but this is unverified.

### Cheapest way to determine it empirically

Once you have credentials and one connected card, this is a ~30-second check on the real
payload (do this against your **real** card via MeuPluggy, not the sandbox — sandbox data is
synthetic and proves nothing about your connector):

```bash
# 1. exchange client credentials for an API key
API_KEY=$(curl -s -X POST https://api.pluggy.ai/auth \
  -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$PLUGGY_CLIENT_ID\",\"clientSecret\":\"$PLUGGY_CLIENT_SECRET\"}" \
  | jq -r .apiKey)

# 2. find your credit-card account id
curl -s -H "X-API-KEY: $API_KEY" \
  "https://api.pluggy.ai/accounts?itemId=$ITEM_ID" | jq '.results[] | {id, type, subtype, name}'

# 3. THE ACTUAL TEST — list every distinct time-of-day in the payload
curl -s -H "X-API-KEY: $API_KEY" \
  "https://api.pluggy.ai/v2/transactions?accountId=$ACCOUNT_ID" \
  | jq -r '.results[].date' | cut -dT -f2 | sort | uniq -c
```

> **RESOLVED — 23 Aug 2026, against a live credit-card payload (500 transactions).**
> The dominant time-of-day is `03:00:00.000Z` (133 of 500), which is exactly midnight in
> São Paulo. Pluggy pads a date-only value to **local** midnight expressed in UTC, not to
> UTC midnight, and otherwise carries a real time of day. Both cases want the same thing:
> a straight IANA conversion, which is what `toSaoPauloDate` now does. The same payload
> also showed 10 of 500 transactions in USD, with the BRL figure in
> `amountInAccountCurrency` — see the money note below.
>
> Re-run the check below if you add a connector of a different type; it is cheap and the
> answer is not guaranteed to be uniform.

Interpretation:

- Output is a **single line `00:00:00.000Z`** → midnight-padded. Bucket by `date.slice(0,10)`,
  do not timezone-convert.
- Output shows **varied times** → real time-of-day. Convert to `America/Sao_Paulo` before taking
  the calendar day.

Run step 3 for **both** a credit-card account and a checking account — the docs never claim they
behave the same, so verify each account type you support. Worth re-checking if you ever add a
new connector.

---

## Reference links

| What | URL |
|---|---|
| Dashboard (sign up, get credentials) | <https://dashboard.pluggy.ai/> |
| Applications tab | <https://dashboard.pluggy.ai/applications> |
| Meu Pluggy (free personal data portal) | <https://meu.pluggy.ai/> |
| Meu Pluggy explainer + step-by-step | <https://www.pluggy.ai/meu-pluggy> |
| Meu Pluggy dev guide (GitHub) | <https://github.com/pluggyai/meu-pluggy> |
| Pricing | <https://www.pluggy.ai/precos> |
| Docs home | <https://docs.pluggy.ai/> |
| Get your API keys | <https://docs.pluggy.ai/docs/get-your-api-keys> |
| Authentication | <https://docs.pluggy.ai/docs/authentication> |
| Sandbox + test credentials | <https://docs.pluggy.ai/docs/sandbox> |
| Transaction product guide | <https://docs.pluggy.ai/docs/transactions> |
| `POST /auth` reference | <https://docs.pluggy.ai/reference/auth-create> |
| `POST /connect_token` reference | <https://docs.pluggy.ai/reference/connect-token-create> |
| `GET /v2/transactions` reference | <https://docs.pluggy.ai/reference/transactions-list-by-cursor> |
| `GET /connectors` reference | <https://docs.pluggy.ai/reference/connectors-list> |
| Widget setup | <https://docs.pluggy.ai/docs/setup-pluggyconnect-widget-on-your-app> |
| Widget options | <https://docs.pluggy.ai/docs/environments-and-configurations> |
| Quickstart repo | <https://github.com/pluggyai/quickstart> |
| Node server SDK | <https://github.com/pluggyai/pluggy-node> |
| LLM-friendly docs index | <https://docs.pluggy.ai/llms.txt> (append `.md` to any docs URL) |
| Discord community | <https://discord.gg/EanrwJADby> |
| Status page | <https://status.pluggy.ai/> |
