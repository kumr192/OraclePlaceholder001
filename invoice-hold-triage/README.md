# Invoice hold triage

This page reads invoice holds from Oracle Fusion Payables. It does not release holds or create payments.

## Run it on your computer

1. Copy the example settings file:

```bash
cp .env.example .env
```

2. Set these keys in `.env`:

- `ORACLE_FUSION_URL` — `https://ibcrqy-test.fa.ocs.oraclecloud.com`
- `ORACLE_FUSION_USER` — the Oracle user name
- `ORACLE_FUSION_PASSWORD` — the Oracle password
- `APP_ACCESS_PASSWORD` — optional here. If you set it, the page asks for this access password. Any username is fine.

3. Start the page:

```bash
node server.js
```

4. Open http://127.0.0.1:3000

You need Node.js 18 or newer. There is nothing to install.

Keep the Oracle password in `.env`. The browser never receives it. Do not commit `.env`.

The page loads open holds first. An open hold has no release name. Check **Include released holds** to add released holds. Open holds stop at 1,000. Released holds stop at the 500 most recent. The page shows a warning when Oracle has more rows than that cap. **Refresh** loads the list again.

Choose a **Business unit** to ask Oracle for that unit only. **All business units** does not add that filter. The list comes from Oracle after the access password succeeds. In sample mode the list comes from the sample invoices.

If the Oracle settings are missing, the page shows sample invoices and labels them **Sample data**. That is not live Fusion data.

A bad Oracle password or a network problem stays an error. The page does not switch those errors to sample data.

## Put it on Vercel

Use Vercel Hobby with these project settings:

- Root Directory: `invoice-hold-triage`
- Framework Preset: Other
- Build Command: leave empty
- Output Directory: `public`

Set these environment variables on the Vercel project. Do not commit the values.

| Key | Value |
| --- | --- |
| `ORACLE_FUSION_URL` | `https://ibcrqy-test.fa.ocs.oraclecloud.com` |
| `ORACLE_FUSION_USER` | Oracle user name, set by the coordinator |
| `ORACLE_FUSION_PASSWORD` | Oracle password, set by the coordinator |
| `APP_ACCESS_PASSWORD` | Site access password, set by the coordinator |

Set `APP_ACCESS_PASSWORD` before sharing the Vercel URL. Without it, anyone who can open the URL can read the holds. The browser asks for any username and that access password.

The Oracle password stays on the server. It is not in the page, the logs, or Git.

`GET /api/holds` and `GET /api/business-units` can run for 60 seconds. Hobby allows that. Open holds are usually faster. Include-released takes longer because it also reads recent released holds and invoice amounts.

Deploy, then open the Vercel URL.

## Checks

From this folder:

```bash
node test.js
```

There is no separate build. The checks use fake Oracle responses. They do not sign in to Oracle. They check paging, supplier, amount, hold reason, the business unit list, summary totals, the access password, and https-only Oracle calls.
