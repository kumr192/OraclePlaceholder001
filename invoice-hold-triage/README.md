# Invoice hold triage

A small, self-contained demonstration of an Oracle Fusion Payables invoice-hold triage desk. Open one page, scan invoices sitting on hold, and read a suggested next step for each hold type.

The page is plain HTML, CSS, and JavaScript. There is no build step and no server requirement.

## Sample data

Every supplier, invoice number, amount, hold, and business unit in this folder is **fictional example data**. It was not exported from Oracle Fusion or any customer ledger. The page does not call an API and does not connect to Oracle Cloud.

Invoice numbers use an `EX-INV-` prefix so they stay visibly marked as examples.

## Run the app

Open `index.html` in a browser. Double-click the file, or use the browser’s File → Open command.

The summary cards follow the current filters:

- **Invoices on hold** — how many example invoices are in the view
- **Amount on hold** — totals split by currency (USD, EUR, GBP, and CAD are not converted into one number)
- **Oldest hold** — the largest hold age, in days, from the hold date to the day you open the page

Use the hold-type list, the business-unit list, and the search box to narrow the table. Suggested actions are simple rules keyed by hold name, for example a Price hold tells you to compare the purchase-order price with the invoice price.

## Run the checks

From this folder:

```bash
node test.js
```

`test.js` checks the summary calculations (invoice count, amount by currency, oldest hold age), filtering, and the suggested-action rules. Ages in the checks use a fixed date, 13 October 2026, so the expected numbers stay stable. The script prints `PASS` for each check and exits with an error if any check fails.
