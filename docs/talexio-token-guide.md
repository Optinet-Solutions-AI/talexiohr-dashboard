# How to Generate & Paste a Talexio Token

This guide explains how to get a fresh **Talexio token** and paste it into the
HR Dashboard so daily syncs and the "Pull from Talexio" button keep working.

---

## Why you need to do this

The dashboard pulls clocking/attendance data from Talexio using a **token**
(a long string that proves you're logged in). Talexio tokens are short-lived —
**they expire roughly every 7 days.**

When the token expires, you'll see a red banner at the top of the dashboard:

> ⚠️ **Talexio sync needs attention**
> Talexio token has expired. Paste a fresh one to resume daily syncs.

…and the daily automated sync will fail with an error like
`Unexpected token '<', "<!doctype "... is not valid JSON` (that error just
means Talexio returned a login page instead of data, because the token is no
longer accepted).

**The fix is always the same: paste a fresh token.** This takes about 2 minutes.

---

## Quick steps (the short version)

1. Open the dashboard → **Import** page.
2. Scroll to the **Talexio Token** card.
3. Click **Paste new token**.
4. Get a fresh token from Talexio (see the two options below).
5. Paste it into the box and click **Validate & save**.
6. Look for the green **"Token saved"** confirmation. Done.

---

## Getting a fresh token — two options

You only need to do **one** of these. Option A is preferred; use Option B if
Option A isn't available to you.

### Option A — From the Talexio dashboard *(preferred)*

1. Go to **[roosterpartners.talexiohr.com](https://roosterpartners.talexiohr.com)**
   and log in (solve the captcha if asked).
2. Open your **access-token / API-token** page in Talexio settings.
3. **Generate or copy** the access token.
4. Copy the whole token. It's a long string that usually starts with `eyJ…`.

> Paste it **as-is** — do **not** add a `Bearer ` prefix.

### Option B — From your browser's DevTools *(fallback)*

Use this if you can't find an access-token page in Talexio settings.

1. Log in at **[roosterpartners.talexiohr.com](https://roosterpartners.talexiohr.com)**.
2. Press **F12** to open DevTools, then click the **Network** tab.
3. Click around any page that loads data (e.g. open a report). Watch the
   Network list fill up.
4. Find a request sent to **`api.talexiohr.com/graphql`** and click it.
5. In the request's **Headers**, find the **`authorization`** header.
   Its value looks like `Bearer eyJ…`.
6. Copy **only the part after `Bearer `** — i.e. drop the leading `Bearer `
   word and the space. You want just the `eyJ…` token itself.

---

## Pasting the token into the dashboard

1. In the dashboard, open the **Import** page.
2. Find the **Talexio Token** card (it turns red when the token is expired or
   missing).
3. Click **Paste new token** (or **Replace token** if one is still valid).
4. Paste your token into the text box.
5. Click **Validate & save**.

### What the dashboard checks before saving

The dashboard runs a few quick checks so a bad paste can't break the sync:

- ✅ The token must be a real JWT (three parts separated by dots: `xxx.yyy.zzz`).
- ✅ It must contain a readable **expiry date** — and that date must be in the
  **future**. If the token is already expired, you'll be told to get a fresh one.
- ℹ️ The dashboard also does a quick live "ping" to Talexio. If that ping
  returns a warning (e.g. *"please select a payroll"*), **that's okay** — it's
  informational only and does **not** block the save. The token can still be
  perfectly valid for the daily sync. The real proof is whether the next sync
  succeeds.

### Confirming it worked

After saving you should see:

- A green **"Token saved. Cron and pulls will use this from now on."** message.
- The Talexio Token card now shows **Valid** with an **Expires in ~7d** time.
- The red **"needs attention"** banner disappears.

---

## Frequently asked questions

**How often do I need to do this?**
About once a week — whenever the banner appears or the token card shows
**Expired** / **expires soon**. There's no way to make Talexio tokens last
longer; pasting a fresh one is the expected routine.

**Do I include the word `Bearer`?**
No. Paste only the token itself (starts with `eyJ…`). The dashboard adds the
`Bearer ` part automatically where needed.

**Who can paste a token?**
Anyone with access to the Import page. The dashboard records who pasted it and
when, shown as "pasted … by …" on the token card.

**Where is the token stored?**
Securely in the dashboard's database (the `talexio_auth` table). The newest
pasted token always wins; it's shared by both the nightly automated sync (cron)
and the manual **Pull from Talexio** button.

**The live ping showed a warning — did it fail?**
Not necessarily. Talexio's verification query is stricter than the actual data
queries the sync uses. As long as the token saved and shows **Valid** with a
future expiry, the daily sync will use it. Confirm by watching the next sync (or
use the manual pull) and checking it succeeds.

**The banner still shows after I pasted a token.**
Refresh the page. If it persists, click **Verify** on the token card to
re-check, and make sure the card shows **Valid** with a future expiry. If a
previous *automated sync* failed, that error line clears after the next
successful sync.
