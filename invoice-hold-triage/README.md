# Invoice hold triage

This page shows invoice holds from Oracle Fusion Payables.

## Run it

1. In this folder, copy the example settings file:

```bash
cp .env.example .env
```

2. Open `.env` and set these three lines:

- `ORACLE_FUSION_URL` — your Fusion web address, such as `https://your-instance.fa.ocs.oraclecloud.com`
- `ORACLE_FUSION_USER` — your user name
- `ORACLE_FUSION_PASSWORD` — your password

3. Run:

```bash
node server.js
```

4. Open http://127.0.0.1:3000

You need Node.js 18 or newer. There is nothing to install.

The password stays in `.env` on the computer that runs `node server.js`. The page in the browser never sees it. Do not commit `.env`. Git already ignores that file.

The page starts with open holds only (holds that have no release date). Check **Include released holds** to show released holds too. **Refresh** loads them again.

If the three settings are missing, the page shows sample invoices and labels them as sample data. That is not your Oracle data.

A bad password or a network problem is shown on the page. The page does not switch to sample data when Oracle rejects the sign-in.

## Checks

From this folder:

```bash
node test.js
```

The checks use fake Oracle responses. They do not sign in to Oracle. They check paging, hold mapping, amount matching, summary totals, and the suggested actions.
