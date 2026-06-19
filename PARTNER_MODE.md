# Partner mode — multi-user, keyless "Connect Wealthsimple"

This is the startup path: your users sign into *your* app, click **Connect Wealthsimple**,
log in through SnapTrade's hosted portal (it handles brokerage login **and 2FA**), and
their portfolio loads. **They never create a SnapTrade account or paste API keys.**

Personal mode (the single-user app with your own SnapTrade keys) is the **default** and
is completely untouched by any of this — partner mode only turns on when the feature
flag is set.

## How it's wired

```
Browser (PartnerApp.jsx)                Dev server (Vite plugin)            External
─────────────────────────              ───────────────────────────         ─────────
sign in  ───────────────────────────►  Supabase Auth (anon key)
                                        returns a JWT
click "Connect Wealthsimple"  ──────►  /api/partner/connect (+ JWT)
                                          verify JWT → app user id
                                          register SnapTrade user once,
                                          store userSecret in Supabase  ───► SnapTrade
                                          loginSnapTradeUser → portal URL
opens SnapTrade portal (snaptrade-react) ───────────────────────────────►  Wealthsimple
                                                                            login + 2FA
load data  ─────────────────────────►  /api/partner/portfolio (+ JWT)
                                          look up userSecret (service role)
                                          read positions/balance  ────────► SnapTrade
```

- **One** partner key pair for the whole app, server-side only.
- Each user's `userSecret` lives in the Supabase `snaptrade_users` table, which has
  **RLS on with no policies** — the browser can't read it; only the backend
  (service-role key) can. The secret never reaches the client.

## One-time setup

1. **Get SnapTrade partner keys** (free to start):
   - Go to **dashboard.snaptrade.com** → create a **Pay-as-you-go** key (NOT a Personal `PERS-` key).
   - First 5 connected users are free.
2. **Get the Supabase service-role key**:
   - Supabase dashboard → **investments-dashboard** → Settings → API → **service_role** (secret).
3. **Fill `app/.env.local`** (already created, Supabase URL + publishable key pre-filled):
   - `SUPABASE_SERVICE_ROLE_KEY=` ← paste the service role key
   - `SNAPTRADE_CLIENT_ID=` / `SNAPTRADE_CONSUMER_KEY=` ← paste the partner keys
   - Uncomment `VITE_SNAPTRADE_MODE=partner`
4. **Restart** `npm run dev` (env + the backend plugin only load at startup).
5. Open http://localhost:5173 → sign up / sign in → **Connect Wealthsimple**.

> Supabase email confirmation: new projects default to "confirm email" ON, so a fresh
> sign-up needs an email click before sign-in. For quick local testing you can turn it
> off in Supabase → Authentication → Providers → Email → "Confirm email".

## Switching back to personal mode

Comment out `VITE_SNAPTRADE_MODE=partner` (or set it to anything else) and restart
`npm run dev`. The original single-user dashboard returns, unchanged.

## Going to production (later)

The Vite plugin backend only runs under `npm run dev` / `vite preview`. For a real
deployment you'd move `server/partnerService.js` behind a small hosted API (e.g. a
Node/Express server, a Supabase Edge Function, or Vercel/Netlify functions) and point
the frontend at it. The logic is identical — same SnapTrade + Supabase calls.
