/**
 * Fictional Payables invoices for the triage demo.
 * Nothing here is extracted from Oracle Fusion or a customer ledger.
 */
(function (root, factory) {
  var invoices = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = invoices;
  } else {
    root.SAMPLE_INVOICES = invoices;
  }
})(typeof self !== "undefined" ? self : this, function () {
  return [
    {
      supplier: "Apex Industrial Supply",
      invoiceNumber: "EX-INV-10041",
      amount: 12450.0,
      currency: "USD",
      holdName: "Price",
      holdDate: "2026-08-20",
      businessUnit: "Vision Operations",
    },
    {
      supplier: "Northline Components",
      invoiceNumber: "EX-INV-10042",
      amount: 3200.5,
      currency: "USD",
      holdName: "Qty Ord",
      holdDate: "2026-09-18",
      businessUnit: "US1 Business Unit",
    },
    {
      supplier: "Meridian Office Goods",
      invoiceNumber: "EX-INV-10043",
      amount: 890.0,
      currency: "USD",
      holdName: "Amount",
      holdDate: "2026-10-01",
      businessUnit: "US1 Business Unit",
    },
    {
      supplier: "Baltic Steel Works",
      invoiceNumber: "EX-INV-10044",
      amount: 15780.25,
      currency: "EUR",
      holdName: "Funds",
      holdDate: "2026-07-30",
      businessUnit: "UK Business Unit",
    },
    {
      supplier: "Cedar Ridge Logistics",
      invoiceNumber: "EX-INV-10045",
      amount: 2140.0,
      currency: "USD",
      holdName: "Dist Variance",
      holdDate: "2026-09-05",
      businessUnit: "Canada Business Unit",
    },
    {
      supplier: "Solstice Chemicals",
      invoiceNumber: "EX-INV-10046",
      amount: 6400.0,
      currency: "USD",
      holdName: "Price",
      holdDate: "2026-08-01",
      businessUnit: "Vision Operations",
    },
    {
      supplier: "Pinnacle Packaging",
      invoiceNumber: "EX-INV-10047",
      amount: 455.75,
      currency: "CAD",
      holdName: "Qty Ord",
      holdDate: "2026-10-08",
      businessUnit: "Canada Business Unit",
    },
    {
      supplier: "Lumen Facilities",
      invoiceNumber: "EX-INV-10048",
      amount: 9800.0,
      currency: "USD",
      holdName: "Funds",
      holdDate: "2026-06-15",
      businessUnit: "US1 Business Unit",
    },
    {
      supplier: "Westbridge Consulting",
      invoiceNumber: "EX-INV-10049",
      amount: 2750.0,
      currency: "GBP",
      holdName: "Amount",
      holdDate: "2026-09-22",
      businessUnit: "UK Business Unit",
    },
    {
      supplier: "Orion Electronics",
      invoiceNumber: "EX-INV-10050",
      amount: 18990.0,
      currency: "USD",
      holdName: "Dist Variance",
      holdDate: "2026-08-28",
      businessUnit: "Vision Operations",
    },
    {
      supplier: "Greenfield Paper",
      invoiceNumber: "EX-INV-10051",
      amount: 1320.4,
      currency: "USD",
      holdName: "Qty Ord",
      holdDate: "2026-10-10",
      businessUnit: "US1 Business Unit",
    },
    {
      supplier: "Helix Medical Supply",
      invoiceNumber: "EX-INV-10052",
      amount: 7605.0,
      currency: "EUR",
      holdName: "Price",
      holdDate: "2026-07-12",
      businessUnit: "UK Business Unit",
    },
    {
      supplier: "Summit Fleet Services",
      invoiceNumber: "EX-INV-10053",
      amount: 4100.0,
      currency: "CAD",
      holdName: "Funds",
      holdDate: "2026-09-01",
      businessUnit: "Canada Business Unit",
    },
    {
      supplier: "Redwood Catering",
      invoiceNumber: "EX-INV-10054",
      amount: 612.18,
      currency: "USD",
      holdName: "Amount",
      holdDate: "2026-10-05",
      businessUnit: "Vision Operations",
    },
    {
      supplier: "Atlas Maintenance",
      invoiceNumber: "EX-INV-10055",
      amount: 22340.0,
      currency: "USD",
      holdName: "Dist Variance",
      holdDate: "2026-08-11",
      businessUnit: "US1 Business Unit",
    },
  ];
});
