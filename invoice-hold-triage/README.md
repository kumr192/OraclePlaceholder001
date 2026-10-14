# Invoice hold triage

This page shows invoice holds from Oracle Fusion Payables.

## Run it on your computer

1. In this folder, copy the example settings file:

```bash
cp .env.example .env
```

2. Open `.env` and set:

- `ORACLE_FUSION_URL` — your Fusion web address, such as `https://your-instance.fa.ocs.oraclecloud.com`
- `ORACLE_FUSION_USER` — your user name
- `ORACLE_FUSION_PASSWORD` — your Oracle password
- `APP_ACCESS_PASSWORD` — optional here. If you set it, the page asks for this password. Any username is fine. This is not your Oracle password.

3. Run:

```bash
node server.js
```

4. Open http://127.0.0.1:3000

You need Node.js 18 or newer. There is nothing to install.

The Oracle password stays in `.env`. The page in the browser never sees it. Do not commit `.env`. Git already ignores that file.

The page starts with open holds only. Open holds are holds with no release name. Check **Include released holds** to add released holds as well. Every open hold stays in the list. Only released holds are capped, at the 500 most recent. **Refresh** loads them again.

If the Oracle settings are missing, the page shows sample invoices and labels them as sample data. That is not your Oracle data.

A bad Oracle password or a network problem is shown on the page. The page does not switch to sample data when Oracle rejects the sign-in.

## Put it on Vercel

The site can run on Vercel Hobby. Use these project settings:

- Root Directory: `invoice-hold-triage`
- Framework Preset: Other
- Build Command: leave empty
- Output Directory: `public`

Then add these environment variables in the Vercel project:

- `ORACLE_FUSION_URL`
- `ORACLE_FUSION_USER`
- `ORACLE_FUSION_PASSWORD`
- `APP_ACCESS_PASSWORD`

Set `APP_ACCESS_PASSWORD`. The Vercel address is public. Without this, anyone who can open the URL can see live invoice holds. When it is set, the browser asks for a username and password. Type any username and use `APP_ACCESS_PASSWORD`.

The Oracle password stays on the server. It is not in the web page.

Loading holds can take about half a minute. The holds function is allowed to run for 60 seconds so Vercel does not stop it early.

Deploy, then open the Vercel URL.

## Checks

From this folder:

```bash
node test.js
```

The checks use fake Oracle responses. They do not sign in to Oracle. They check paging, hold mapping, amount matching, summary totals, the access password, and the suggested actions.
