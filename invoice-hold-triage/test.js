/**
 * Node checks for summary totals, hold mapping, paging, and suggested actions.
 * Oracle calls are mocked. Run from this folder: node test.js
 */
var assert = require("assert");
var http = require("http");
var triage = require("./public/triage.js");
var invoices = require("./data.js");
var oracle = require("./oracle.js");
var envFile = require("./env.js");
var server = require("./server.js");
var access = require("./access.js");
var holdsApi = require("./api/holds.js");
var businessUnitsApi = require("./api/business-units.js");
var holds = require("./holds.js");

var AS_OF = "2026-10-13";
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failed += 1;
    console.error("FAIL  " + name);
    console.error(err && err.stack ? err.stack : err);
  }
}

test("sample file contains 15 example invoices", function () {
  assert.strictEqual(invoices.length, 15);
});

test("full summary counts invoices and totals each currency", function () {
  var summary = triage.summarize(invoices, AS_OF);
  assert.strictEqual(summary.invoiceCount, 15);
  assert.deepStrictEqual(summary.totalsByCurrency, {
    CAD: 4555.75,
    EUR: 23385.25,
    GBP: 2750,
    USD: 78143.08,
  });
  assert.strictEqual(summary.oldestAgeDays, 120);
  assert.strictEqual(summary.oldestInvoiceNumber, "EX-INV-10048");
  assert.strictEqual(summary.oldestHoldDate, "2026-06-15");
});

test("currency totals are rounded to cents", function () {
  var summary = triage.summarize(
    [
      { invoiceNumber: "A", amount: 0.1, currency: "USD", holdDate: "2026-10-13" },
      { invoiceNumber: "B", amount: 0.2, currency: "USD", holdDate: "2026-10-13" },
    ],
    AS_OF
  );
  assert.strictEqual(summary.totalsByCurrency.USD, 0.3);
});

test("oldest age uses the latest hold date in the set", function () {
  assert.strictEqual(triage.ageInDays("2026-10-13", AS_OF), 0);
  assert.strictEqual(triage.ageInDays("2026-10-12", AS_OF), 1);
  assert.strictEqual(triage.ageInDays("2026-06-15", "2026-10-13"), 120);
  assert.strictEqual(triage.ageInDays("2026-07-12", "2026-10-13"), 93);
});

test("empty view has a zero count and no oldest hold", function () {
  var summary = triage.summarize([], AS_OF);
  assert.strictEqual(summary.invoiceCount, 0);
  assert.deepStrictEqual(summary.totalsByCurrency, {});
  assert.strictEqual(summary.oldestAgeDays, null);
  assert.strictEqual(summary.oldestInvoiceNumber, null);
});

test("Price hold filter keeps three invoices and the oldest is Helix", function () {
  var filtered = triage.filterInvoices(invoices, { holdType: "Price" });
  var summary = triage.summarize(filtered, AS_OF);
  assert.strictEqual(summary.invoiceCount, 3);
  assert.deepStrictEqual(summary.totalsByCurrency, {
    EUR: 7605,
    USD: 18850,
  });
  assert.strictEqual(summary.oldestAgeDays, 93);
  assert.strictEqual(summary.oldestInvoiceNumber, "EX-INV-10052");
});

test("business unit filter and search narrow the same summary", function () {
  var canada = triage.filterInvoices(invoices, { businessUnit: "Canada Business Unit" });
  assert.strictEqual(triage.summarize(canada, AS_OF).invoiceCount, 3);

  var lumen = triage.filterInvoices(invoices, { query: "  lUmEn  " });
  var lumenSummary = triage.summarize(lumen, AS_OF);
  assert.strictEqual(lumenSummary.invoiceCount, 1);
  assert.strictEqual(lumenSummary.totalsByCurrency.USD, 9800);
  assert.strictEqual(lumenSummary.oldestAgeDays, 120);

  var combined = triage.filterInvoices(invoices, {
    holdType: "Funds",
    businessUnit: "UK Business Unit",
    query: "eur",
  });
  assert.deepStrictEqual(
    combined.map(function (invoice) {
      return invoice.invoiceNumber;
    }),
    ["EX-INV-10044"]
  );
});

test("a search with no match produces an empty summary", function () {
  var none = triage.filterInvoices(invoices, { query: "not-a-supplier" });
  var summary = triage.summarize(none, AS_OF);
  assert.strictEqual(summary.invoiceCount, 0);
  assert.strictEqual(summary.oldestAgeDays, null);
});

test("each sample hold type has rule-based advice", function () {
  var holdNames = triage.uniqueSorted(
    invoices.map(function (invoice) {
      return invoice.holdName;
    })
  );
  assert.deepStrictEqual(holdNames, ["Amount", "Dist Variance", "Funds", "Price", "Qty Ord"]);
  holdNames.forEach(function (holdName) {
    var advice = triage.suggestedAction(holdName);
    assert.strictEqual(advice, triage.HOLD_ACTIONS[holdName]);
    assert.ok(advice.length > 40);
  });
  assert.ok(triage.suggestedAction("Price").toLowerCase().indexOf("price") !== -1);
  assert.ok(triage.suggestedAction("qty rec").toLowerCase().indexOf("received") !== -1);
  assert.strictEqual(triage.suggestedAction("Not A Hold"), triage.FALLBACK_ACTION);
  assert.ok(triage.suggestedAction("Custom Hold", "Supplier bank account is missing").indexOf("bank account") !== -1);
});

test("duplicate holds on one invoice are counted once in the amount", function () {
  var summary = triage.summarize(
    [
      {
        supplier: "Apex",
        invoiceNumber: "100",
        businessUnit: "Vision Operations",
        amount: 50,
        currency: "USD",
        holdDate: "2026-10-01",
        holdName: "Price",
      },
      {
        supplier: "Apex",
        invoiceNumber: "100",
        businessUnit: "Vision Operations",
        amount: 50,
        currency: "USD",
        holdDate: "2026-09-01",
        holdName: "Funds",
      },
      {
        supplier: "Apex",
        invoiceNumber: "200",
        businessUnit: "Vision Operations",
        amount: null,
        currency: "",
        holdDate: "2026-10-10",
        holdName: "Tax",
      },
    ],
    AS_OF
  );
  assert.strictEqual(summary.invoiceCount, 2);
  assert.strictEqual(summary.holdCount, 3);
  assert.strictEqual(summary.missingAmountCount, 1);
  assert.strictEqual(summary.totalsByCurrency.USD, 50);
  assert.strictEqual(summary.oldestInvoiceNumber, "100");
});

test("settings are missing until url, user, and password are all set", function () {
  assert.strictEqual(envFile.fusionConfig({}), null);
  assert.strictEqual(
    envFile.fusionConfig({
      ORACLE_FUSION_URL: "https://example.test",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: "",
    }),
    null
  );
  var parsed = envFile.parseEnv("# comment\nORACLE_FUSION_USER=fin_impl\nORACLE_FUSION_PASSWORD=\"keep me\"\n\n");
  assert.strictEqual(parsed.ORACLE_FUSION_USER, "fin_impl");
  assert.strictEqual(parsed.ORACLE_FUSION_PASSWORD, "keep me");
});

test("a parent invoice link supplies the amount when the supplier name differs", function () {
  var raw = {
    InvoiceNumber: "100",
    BusinessUnit: "Vision Operations",
    Supplier: "Hold Supplier",
    ReleaseName: null,
    ReleaseDate: null,
    links: [
      {
        rel: "parent",
        href: "https://fa-example.example.com/fscmRestApi/resources/11.13.18.05/invoices/555",
      },
    ],
  };
  assert.strictEqual(oracle.invoiceIdFromHold(raw), "555");
  var found = oracle.lookupInvoice(
    oracle.indexInvoices([
      {
        InvoiceId: 555,
        InvoiceNumber: "100",
        BusinessUnit: "Other BU",
        Supplier: "Invoice Supplier",
        InvoiceAmount: 42,
        InvoiceCurrency: "USD",
      },
    ]),
    raw
  );
  assert.strictEqual(found.amount, 42);
  var onlyNumber = oracle.lookupInvoice(
    oracle.indexInvoices([
      {
        InvoiceNumber: "100",
        BusinessUnit: "Z",
        Supplier: "Y",
        InvoiceAmount: 7,
        InvoiceCurrency: "CAD",
      },
    ]),
    { InvoiceNumber: "100", BusinessUnit: "A", Supplier: "B" }
  );
  assert.strictEqual(onlyNumber.amount, 7);
});

test("an Oracle hold maps onto the triage row and joins the invoice amount", function () {
  var raw = {
    HoldId: 300100187353833,
    InvoiceNumber: "AND_Unmatched_Invoice",
    BusinessUnit: "Vision Operations",
    Supplier: "Advanced Network Devices",
    LineHeld: null,
    HoldDate: "2020-05-29T06:53:19.001+00:00",
    HoldDetails: null,
    HoldReason: "Invoice amount exceeded limit.",
    ReleaseReason: null,
    WorkflowStatus: null,
    ReleaseName: null,
    HoldName: "Amount",
    ReleaseDate: null,
    HeldBy: "Kerry Jones",
    CreatedBy: "AP_SUPV_OPERATIONS",
    CreationDate: "2020-05-29T06:53:19.001+00:00",
  };
  var released = Object.assign({}, raw, {
    HoldId: 2,
    InvoiceNumber: "PAID-1",
    ReleaseName: "Qty Rec",
    ReleaseDate: "2020-06-01T00:00:00+00:00",
    HoldName: "Qty Rec",
  });
  var rows = oracle.mapHolds(oracle.selectOpenHolds([raw, released], false), [
    {
      InvoiceNumber: "AND_Unmatched_Invoice",
      BusinessUnit: "Vision Operations",
      Supplier: "Advanced Network Devices",
      InvoiceAmount: 1500.5,
      InvoiceCurrency: "USD",
    },
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].invoiceNumber, "AND_Unmatched_Invoice");
  assert.strictEqual(rows[0].holdDate, "2020-05-29");
  assert.strictEqual(rows[0].released, false);
  assert.strictEqual(rows[0].amount, 1500.5);
  assert.strictEqual(rows[0].currency, "USD");
  assert.strictEqual(rows[0].holdName, "Amount");
  assert.ok(triage.suggestedAction(rows[0].holdName, rows[0].holdReason).toLowerCase().indexOf("amount") !== -1);
});

var pending = 0;

function testAsync(name, fn) {
  pending += 1;
  Promise.resolve()
    .then(fn)
    .then(function () {
      console.log("PASS  " + name);
    })
    .catch(function (err) {
      failed += 1;
      console.error("FAIL  " + name);
      console.error(err && err.stack ? err.stack : err);
    })
    .finally(function () {
      pending -= 1;
      if (pending === 0) {
        finish();
      }
    });
}

function finish() {
  if (failed > 0) {
    console.error("\n" + failed + " check(s) failed.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

testAsync("paging follows hasMore and offset, then keeps only open holds", function () {
  var offsets = [];
  return oracle
    .collectPages(function (offset) {
      offsets.push(offset);
      if (offset === 0) {
        return Promise.resolve({
          items: [
            { HoldId: 1, InvoiceNumber: "A", ReleaseDate: null },
            { HoldId: 2, InvoiceNumber: "B", ReleaseDate: null },
          ],
          hasMore: true,
          limit: 2,
          offset: 0,
        });
      }
      return Promise.resolve({
        items: [
          { HoldId: 3, InvoiceNumber: "C", ReleaseName: "Amount", ReleaseDate: "2026-01-01" },
          { HoldId: 4, InvoiceNumber: "D", ReleaseDate: null },
        ],
        hasMore: false,
        limit: 2,
        offset: 2,
      });
    })
    .then(function (items) {
      assert.deepStrictEqual(offsets, [0, 2]);
      assert.strictEqual(items.length, 4);
      var open = oracle.selectOpenHolds(items, false);
      assert.deepStrictEqual(
        open.map(function (item) {
          return item.HoldId;
        }),
        [1, 2, 4]
      );
    });
});

testAsync("paging stops when Oracle repeats the same offset", function () {
  return oracle
    .collectPages(function () {
      return Promise.resolve({
        items: [{ HoldId: 1 }],
        hasMore: true,
        limit: 0,
        offset: 0,
      });
    })
    .then(function () {
      throw new Error("expected paging to fail");
    })
    .catch(function (err) {
      if (err && err.message === "expected paging to fail") {
        throw err;
      }
      assert.strictEqual(err.kind, "oracle");
    });
});

function parentLink(id) {
  return {
    rel: "parent",
    name: "invoices",
    href: "https://fa-example.example.com/fscmRestApi/resources/11.13.18.05/invoices/" + id,
  };
}

function mockFusion(password) {
  return function (url, options) {
    var parsed = new URL(url);
    var header = options.headers.Authorization;
    assert.strictEqual(options.method, "GET");
    assert.strictEqual(options.body, undefined);
    assert.strictEqual(String(url).indexOf(password), -1);
    assert.strictEqual(header.indexOf(password), -1);
    assert.strictEqual(header, "Basic " + Buffer.from("fin_impl:" + password).toString("base64"));
    if (parsed.pathname.indexOf("invoiceHolds") !== -1) {
      var q = parsed.searchParams.get("q");
      assert.notStrictEqual(q, "ReleaseDate IS NULL");
      assert.strictEqual(q, "ReleaseName IS NULL");
      var offset = Number(parsed.searchParams.get("offset"));
      if (offset === 0) {
        return jsonResult(200, {
          items: [openHold("A-1", 101), openHold("A-2", 102)],
          hasMore: true,
          limit: 500,
          offset: 0,
        });
      }
      return jsonResult(200, {
        items: [releasedHold("B-9"), openHold("C-3", 103)],
        hasMore: false,
        limit: 500,
        offset: offset,
      });
    }
    var idMatch = parsed.pathname.match(/\/invoices\/(\d+)$/);
    if (idMatch) {
      var amounts = { 101: [80, "USD", "A-1"], 102: [15, "USD", "A-2"], 103: [20, "EUR", "C-3"] };
      var amount = amounts[idMatch[1]];
      return jsonResult(200, {
        InvoiceId: Number(idMatch[1]),
        InvoiceNumber: amount[2],
        BusinessUnit: "Some Other Unit",
        Supplier: "Different Supplier",
        InvoiceAmount: amount[0],
        InvoiceCurrency: amount[1],
      });
    }
    throw new Error("unexpected url " + url);
  };
}

function openHold(number, id) {
  return {
    HoldId: number,
    InvoiceNumber: number,
    BusinessUnit: "Vision Operations",
    Supplier: "Name That Will Not Match",
    HoldDate: "2026-08-01T00:00:00+00:00",
    HoldName: number === "C-3" ? "Qty Rec" : "Price",
    HoldReason: null,
    ReleaseName: null,
    ReleaseDate: null,
    links: [parentLink(id)],
  };
}

function releasedHold(number) {
  return Object.assign(openHold(number, 999), {
    ReleaseName: "Amount",
    ReleaseDate: "2026-09-01T00:00:00+00:00",
    HoldName: "Funds",
  });
}

function jsonResult(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    text: function () {
      return Promise.resolve(JSON.stringify(body));
    },
    json: function () {
      return Promise.resolve(body);
    },
  });
}

testAsync("live load pages holds, drops released rows, and does not leak the password", function () {
  var password = "s3cret-value";
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com/fscmRestApi",
      user: "fin_impl",
      password: password,
      includeReleased: false,
      fetch: mockFusion(password),
    })
    .then(function (result) {
      assert.strictEqual(result.warning, null);
      assert.deepStrictEqual(
        result.holds.map(function (hold) {
          return hold.invoiceNumber;
        }),
        ["A-1", "A-2", "C-3"]
      );
      assert.strictEqual(result.holds[0].amount, 80);
      assert.strictEqual(result.holds[0].currency, "USD");
      assert.strictEqual(result.holds[1].amount, 15);
      assert.strictEqual(result.holds[2].amount, 20);
      assert.strictEqual(result.holds[2].currency, "EUR");
      assert.strictEqual(result.holds[0].supplier, "Name That Will Not Match");
      assert.strictEqual(JSON.stringify(result).indexOf(password), -1);
      assert.strictEqual(oracle.siteRoot("https://fa-example.example.com/fscmRestApi"), "https://fa-example.example.com");
    });
});

testAsync("a rejected sign-in is reported without calling invoices", function () {
  var calls = 0;
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "nope",
      includeReleased: false,
      fetch: function () {
        calls += 1;
        return jsonResult(401, { detail: "Unauthorized" });
      },
    })
    .then(function () {
      throw new Error("expected login failure");
    })
    .catch(function (err) {
      if (err && err.message === "expected login failure") {
        throw err;
      }
      assert.strictEqual(err.kind, "login");
      assert.ok(err.message.indexOf("sign-in") !== -1);
      assert.strictEqual(err.message.indexOf("nope"), -1);
      assert.strictEqual(calls, 1);
    });
});

testAsync("a network failure stays a network error", function () {
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: true,
      fetch: function () {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      },
    })
    .then(function () {
      throw new Error("expected network failure");
    })
    .catch(function (err) {
      if (err && err.message === "expected network failure") {
        throw err;
      }
      assert.strictEqual(err.kind, "network");
      assert.ok(err.message.indexOf("Could not reach") !== -1);
    });
});

function listen(app) {
  return new Promise(function (resolve) {
    var httpServer = http.createServer(app);
    httpServer.listen(0, "127.0.0.1", function () {
      resolve(httpServer);
    });
  });
}

function getJson(httpServer, path, headers) {
  var port = httpServer.address().port;
  return fetch("http://127.0.0.1:" + port + path, { headers: headers || {} }).then(function (response) {
    return response.text().then(function (text) {
      var body = null;
      try {
        body = JSON.parse(text);
      } catch (err) {
        body = text;
      }
      return { status: response.status, body: body };
    });
  });
}

testAsync("missing settings serve labeled sample data and hide server files", function () {
  var app = server.createApp({ env: {}, fetch: function () {
    throw new Error("Oracle must not be called");
  } });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return getJson(httpServer, "/api/holds");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body.mode, "sample");
      assert.strictEqual(result.body.holds.length, 15);
      assert.strictEqual(result.body.holds[0].released, false);
      return getJson(httpServer, "/.env");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 404);
      return getJson(httpServer, "/server.js");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 404);
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("the API returns live rows from a mocked Oracle and omits the password", function () {
  var password = "s3cret-value";
  var app = server.createApp({
    env: {
      ORACLE_FUSION_URL: "https://fa-example.example.com",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: password,
      APP_ACCESS_PASSWORD: "gate-secret",
    },
    fetch: mockFusion(password),
  });
  var httpServer;
  var auth = { Authorization: basicHeader("anyone", "gate-secret") };
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return getJson(httpServer, "/api/holds", auth);
    })
    .then(function (result) {
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body.mode, "live");
      assert.strictEqual(result.body.holds.length, 3);
      assert.strictEqual(JSON.stringify(result.body).indexOf(password), -1);
      assert.strictEqual(JSON.stringify(result.body).indexOf("gate-secret"), -1);
      return getJson(httpServer, "/api/holds?includeReleased=false", auth);
    })
    .then(function (result) {
      assert.ok(result.body.holds.every(function (hold) {
        return hold.released === false;
      }));
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("an empty open-hold query warns and does not page every released hold", function () {
  var urls = [];
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: false,
      fetch: function (url) {
        urls.push(String(url));
        var parsed = new URL(url);
        var q = parsed.searchParams.get("q");
        if (parsed.pathname.indexOf("invoiceHolds") === -1) {
          throw new Error("invoices should not be loaded when there are no holds");
        }
        if (q === "ReleaseName IS NULL" || q === "ReleaseName IS NULL;ReleaseDate IS NULL") {
          return jsonResult(200, { items: [], count: 0, hasMore: false, limit: 500, offset: 0 });
        }
        assert.strictEqual(q, null);
        assert.strictEqual(parsed.searchParams.get("limit"), "1");
        return jsonResult(200, {
          items: [
            {
              HoldId: 9,
              InvoiceNumber: "OLD",
              ReleaseName: "Amount",
              ReleaseDate: "2020-01-01T00:00:00+00:00",
            },
          ],
          hasMore: true,
          limit: 1,
          offset: 0,
        });
      },
    })
    .then(function (result) {
      assert.strictEqual(result.holds.length, 0);
      assert.ok(result.warning.indexOf("Include released holds") !== -1);
      assert.strictEqual(
        urls.some(function (url) {
          return new URL(url).searchParams.get("q") === "ReleaseDate IS NULL";
        }),
        false
      );
      assert.ok(urls.length <= 3);
    });
});

testAsync("include released keeps every open hold and caps only released holds", function () {
  var queries = [];
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: true,
      releasedCap: 2,
      fetch: function (url) {
        var parsed = new URL(url);
        if (parsed.pathname.indexOf("invoiceHolds") !== -1) {
          var q = parsed.searchParams.get("q");
          queries.push(q);
          if (q === "ReleaseName IS NULL") {
            assert.strictEqual(parsed.searchParams.get("orderBy"), null);
            assert.ok(Number(parsed.searchParams.get("limit")) > 2);
            return jsonResult(200, {
              items: [openHold("O-1", 11), openHold("O-2", 12), openHold("O-3", 13)],
              hasMore: false,
              limit: 500,
              offset: 0,
            });
          }
          assert.strictEqual(q, "ReleaseName IS NOT NULL");
          assert.strictEqual(parsed.searchParams.get("orderBy"), "HoldDate:desc");
          assert.strictEqual(parsed.searchParams.get("limit"), "2");
          assert.strictEqual(parsed.searchParams.get("offset"), "0");
          return jsonResult(200, {
            items: [
              {
                HoldId: "O-1",
                InvoiceNumber: "O-1",
                Supplier: "Hold Supplier",
                BusinessUnit: "Vision Operations",
                ReleaseName: "Amount",
                ReleaseDate: "2026-03-01T00:00:00+00:00",
                HoldDate: "2026-03-01T00:00:00+00:00",
                HoldName: "Amount",
                links: [parentLink(11)],
              },
              {
                HoldId: "R-9",
                InvoiceNumber: "R-9",
                Supplier: "Hold Supplier",
                BusinessUnit: "Vision Operations",
                ReleaseName: "Price",
                ReleaseDate: "2026-02-01T00:00:00+00:00",
                HoldDate: "2026-02-01T00:00:00+00:00",
                HoldName: "Price",
                links: [parentLink(19)],
              },
            ],
            hasMore: true,
            limit: 2,
            offset: 0,
          });
        }
        var idMatch = parsed.pathname.match(/\/invoices\/(\d+)$/);
        assert.ok(idMatch);
        return jsonResult(200, {
          InvoiceId: Number(idMatch[1]),
          InvoiceNumber: "INV-" + idMatch[1],
          BusinessUnit: "Elsewhere",
          Supplier: "Someone Else",
          InvoiceAmount: 10,
          InvoiceCurrency: "USD",
        });
      },
    })
    .then(function (result) {
      assert.deepStrictEqual(queries, ["ReleaseName IS NULL", "ReleaseName IS NOT NULL"]);
      assert.deepStrictEqual(
        result.holds.map(function (hold) {
          return hold.holdId;
        }),
        ["O-1", "O-2", "O-3", "R-9"]
      );
      assert.strictEqual(result.truncated, true);
      assert.ok(result.warning.indexOf("Released holds are capped") !== -1);
      assert.ok(result.warning.indexOf("Fetched the 2 most recent released holds") !== -1);
      assert.strictEqual(result.warning.indexOf("Only released"), -1);
      assert.ok(result.holds.every(function (hold) {
        return hold.amount === 10 && hold.currency === "USD";
      }));
    });
});

test("a lowercase business unit still matches the server filter", function () {
  var rows = triage.filterInvoices(
    [
      {
        invoiceNumber: "A",
        businessUnit: "Canada Business Unit",
        holdName: "Price",
        amount: 1,
        currency: "USD",
        holdDate: "2026-01-01",
      },
    ],
    { businessUnit: "canada business unit" }
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(
    triage.filterInvoices(rows, { businessUnit: "all" }).length,
    1
  );
});

test("ambiguous invoice numbers do not invent an amount", function () {
  var raw = {
    InvoiceNumber: "100",
    BusinessUnit: "Vision Operations",
    Supplier: "Hold Supplier",
    ReleaseName: null,
  };
  var ambiguous = oracle.lookupInvoice(
    oracle.indexInvoices([
      {
        InvoiceNumber: "100",
        BusinessUnit: "Other",
        Supplier: "A",
        InvoiceAmount: 7,
        InvoiceCurrency: "USD",
      },
      {
        InvoiceNumber: "100",
        BusinessUnit: "Elsewhere",
        Supplier: "B",
        InvoiceAmount: 9,
        InvoiceCurrency: "EUR",
      },
    ]),
    raw
  );
  assert.strictEqual(ambiguous, null);
  var row = oracle.mapHold(raw, ambiguous);
  assert.strictEqual(row.amount, null);
  assert.strictEqual(row.currency, "");
  assert.strictEqual(row.supplier, "Hold Supplier");
  var tied = oracle.lookupInvoice(
    oracle.indexInvoices([
      {
        InvoiceNumber: "100",
        BusinessUnit: "Vision Operations",
        Supplier: "Hold Supplier",
        InvoiceAmount: 1,
        InvoiceCurrency: "USD",
      },
      {
        InvoiceNumber: "100",
        BusinessUnit: "Vision Operations",
        Supplier: "Hold Supplier",
        InvoiceAmount: 2,
        InvoiceCurrency: "USD",
      },
    ]),
    raw
  );
  assert.strictEqual(tied, null);
  var uniqueUnit = oracle.lookupInvoice(
    oracle.indexInvoices([
      {
        InvoiceNumber: "100",
        BusinessUnit: "Vision Operations",
        Supplier: "Someone",
        InvoiceAmount: 4,
        InvoiceCurrency: "USD",
      },
      {
        InvoiceNumber: "100",
        BusinessUnit: "Other",
        Supplier: "Else",
        InvoiceAmount: 8,
        InvoiceCurrency: "EUR",
      },
    ]),
    raw
  );
  assert.strictEqual(uniqueUnit.amount, 4);
});

test("the access gate accepts any username when the password matches", function () {
  assert.strictEqual(access.authorize(null, "").ok, true);
  assert.strictEqual(access.authorize(null, undefined).ok, true);
  var liveEnv = {
    ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
    ORACLE_FUSION_USER: "fin_impl",
    ORACLE_FUSION_PASSWORD: "oracle-secret",
  };
  var blocked = access.authorize(null, "", liveEnv);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.status, 503);
  assert.strictEqual(blocked.code, "config-required");
  assert.ok(blocked.message.indexOf("config-required") !== -1);
  assert.strictEqual(blocked.message.indexOf("oracle-secret"), -1);
  assert.strictEqual(blocked.authenticate, undefined);
  var token = Buffer.from("anyone:open-sesame", "utf8").toString("base64");
  var good = access.authorize("Basic " + token, "open-sesame");
  assert.strictEqual(good.ok, true);
  var otherUser = Buffer.from(":open-sesame", "utf8").toString("base64");
  assert.strictEqual(access.authorize("Basic " + otherUser, "open-sesame").ok, true);
  var wrong = access.authorize("Basic " + Buffer.from("anyone:nope", "utf8").toString("base64"), "open-sesame");
  assert.strictEqual(wrong.ok, false);
  assert.ok(wrong.authenticate.indexOf("Basic") === 0);
  assert.strictEqual(wrong.message.indexOf("open-sesame"), -1);
  var withColon = Buffer.from("user:pass:word", "utf8").toString("base64");
  assert.strictEqual(access.authorize("Basic " + withColon, "pass:word").ok, true);
});

function basicHeader(username, password) {
  return "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
}

testAsync("the local server asks for the access password before the page or API", function () {
  var oracleCalls = 0;
  var app = server.createApp({
    env: {
      APP_ACCESS_PASSWORD: "gate-secret",
      ORACLE_FUSION_URL: "https://fa-example.example.com",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: "oracle-secret",
    },
    fetch: function () {
      oracleCalls += 1;
      return jsonResult(200, { items: [], hasMore: false, limit: 1, offset: 0, count: 0 });
    },
  });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return getJson(httpServer, "/api/holds");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 401);
      assert.strictEqual(result.body, "Sign in to view invoice holds.");
      assert.strictEqual(String(result.body).indexOf("oracle-secret"), -1);
      assert.strictEqual(oracleCalls, 0);
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/", {
        headers: { Authorization: basicHeader("pat", "wrong") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 401);
      assert.strictEqual(oracleCalls, 0);
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/api/holds", {
        headers: { Authorization: basicHeader("anyone", "gate-secret") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 200);
      assert.ok(oracleCalls > 0);
      return response.text();
    })
    .then(function (text) {
      assert.strictEqual(text.indexOf("oracle-secret"), -1);
      var body = JSON.parse(text);
      assert.strictEqual(body.mode, "live");
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/", {
        headers: { Authorization: basicHeader("anyone", "gate-secret") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 200);
      return response.text();
    })
    .then(function (html) {
      assert.ok(html.indexOf("Invoice hold triage") !== -1);
      assert.strictEqual(html.indexOf("oracle-secret"), -1);
      assert.strictEqual(html.indexOf("ORACLE_FUSION_PASSWORD"), -1);
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("the Vercel holds function uses the same gate and does not leak Oracle settings", function () {
  var previous = process.env.APP_ACCESS_PASSWORD;
  process.env.APP_ACCESS_PASSWORD = "gate-secret";
  var res = mockResponse();
  return Promise.resolve(
    holdsApi({ method: "GET", url: "/api/holds", headers: {} }, res)
  )
    .then(function () {
      assert.strictEqual(res.statusCode, 401);
      assert.ok(String(res.headers["WWW-Authenticate"]).indexOf("Basic") === 0);
      assert.strictEqual(res.body.indexOf("gate-secret"), -1);
      var ok = mockResponse();
      return holdsApi(
        {
          method: "GET",
          url: "/api/holds",
          headers: { authorization: basicHeader("x", "gate-secret") },
        },
        ok
      ).then(function () {
        return ok;
      });
    })
    .then(function (ok) {
      var body = JSON.parse(ok.body);
      assert.strictEqual(ok.statusCode, 200);
      assert.strictEqual(body.mode, "sample");
      assert.strictEqual(JSON.stringify(body).indexOf("gate-secret"), -1);
    })
    .finally(function () {
      if (previous === undefined) {
        delete process.env.APP_ACCESS_PASSWORD;
      } else {
        process.env.APP_ACCESS_PASSWORD = previous;
      }
    });
});

test("the Oracle host must be https and must not carry a password", function () {
  assert.strictEqual(
    oracle.siteRoot("https://ibcrqy-test.fa.ocs.oraclecloud.com/"),
    "https://ibcrqy-test.fa.ocs.oraclecloud.com"
  );
  assert.throws(function () {
    oracle.siteRoot("http://ibcrqy-test.fa.ocs.oraclecloud.com");
  }, function (err) {
    return err.kind === "network" && String(err.message).indexOf("https://") !== -1;
  });
  assert.throws(function () {
    oracle.siteRoot("https://user:oracle-secret@ibcrqy-test.fa.ocs.oraclecloud.com/fscmRestApi");
  }, function (err) {
    return err.kind === "network" && String(err.message).indexOf("oracle-secret") === -1;
  });
});

test("a hold keeps the invoice supplier, amount, and hold reason", function () {
  var row = oracle.mapHold(
    {
      HoldId: 7,
      InvoiceNumber: "",
      Supplier: " ",
      BusinessUnit: "",
      HoldName: "Price",
      HoldReason: "Price exceeds PO",
      HoldDate: "2026-08-01T00:00:00+00:00",
    },
    {
      supplier: "Invoice Supplier",
      invoiceNumber: "INV-7",
      businessUnit: "Canada Business Unit",
      amount: 12.5,
      currency: "USD",
    }
  );
  assert.strictEqual(row.supplier, "Invoice Supplier");
  assert.strictEqual(row.invoiceNumber, "INV-7");
  assert.strictEqual(row.businessUnit, "Canada Business Unit");
  assert.strictEqual(row.amount, 12.5);
  assert.strictEqual(row.currency, "USD");
  assert.strictEqual(row.holdReason, "Price exceeds PO");
});

test("startup logs block live holds when the access password is missing", function () {
  var text = server.describeStartup({
    ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
    ORACLE_FUSION_USER: "fin_impl",
    ORACLE_FUSION_PASSWORD: "oracle-secret",
  }).join("\n");
  assert.ok(text.indexOf("blocked") !== -1);
  assert.strictEqual(text.indexOf("will load live holds"), -1);
  assert.strictEqual(text.indexOf("oracle-secret"), -1);
  assert.strictEqual(text.indexOf("fin_impl"), -1);
});

test("startup logs do not include Oracle credentials", function () {
  var text = server.describeStartup({
    ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
    ORACLE_FUSION_USER: "fin_impl",
    ORACLE_FUSION_PASSWORD: "oracle-secret",
    APP_ACCESS_PASSWORD: "gate-secret",
  }).join("\n");
  assert.ok(text.indexOf("live holds") !== -1);
  assert.ok(text.indexOf("Access password is set") !== -1);
  assert.strictEqual(text.indexOf("oracle-secret"), -1);
  assert.strictEqual(text.indexOf("fin_impl"), -1);
  assert.strictEqual(text.indexOf("gate-secret"), -1);
});

test("a business unit is added to the Oracle hold query", function () {
  assert.strictEqual(oracle.holdQueryFor("ReleaseName IS NULL", ""), "ReleaseName IS NULL");
  assert.strictEqual(oracle.holdQueryFor("ReleaseName IS NULL", "all"), "ReleaseName IS NULL");
  assert.strictEqual(
    oracle.holdQueryFor("ReleaseName IS NULL", "Vision Operations"),
    "ReleaseName IS NULL;BusinessUnit='Vision Operations'"
  );
  assert.strictEqual(
    oracle.holdQueryFor("ReleaseName IS NOT NULL", "O'Brien"),
    "ReleaseName IS NOT NULL;BusinessUnit='O''Brien'"
  );
});

testAsync("a selected business unit is sent to Oracle and other units are left out", function () {
  var queries = [];
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: true,
      businessUnit: "Vision Operations",
      releasedCap: 5,
      fetch: function (url) {
        var parsed = new URL(url);
        if (parsed.pathname.indexOf("invoiceHolds") !== -1) {
          var q = parsed.searchParams.get("q");
          queries.push(q);
          if (q.indexOf("ReleaseName IS NULL") === 0) {
            return jsonResult(200, {
              items: [
                openHold("KEEP", 21),
                Object.assign(openHold("DROP", 22), { BusinessUnit: "Other Unit" }),
              ],
              hasMore: false,
              limit: 500,
              offset: 0,
            });
          }
          assert.strictEqual(q, "ReleaseName IS NOT NULL;BusinessUnit='Vision Operations'");
          return jsonResult(200, { items: [], hasMore: false, limit: 5, offset: 0 });
        }
        var idMatch = parsed.pathname.match(/\/invoices\/(\d+)$/);
        assert.ok(idMatch);
        return jsonResult(200, {
          InvoiceId: Number(idMatch[1]),
          InvoiceNumber: "KEEP",
          BusinessUnit: "Vision Operations",
          Supplier: "Kept Supplier",
          InvoiceAmount: 10,
          InvoiceCurrency: "USD",
        });
      },
    })
    .then(function (result) {
      assert.deepStrictEqual(queries, [
        "ReleaseName IS NULL;BusinessUnit='Vision Operations'",
        "ReleaseName IS NOT NULL;BusinessUnit='Vision Operations'",
      ]);
      assert.deepStrictEqual(
        result.holds.map(function (hold) {
          return hold.invoiceNumber;
        }),
        ["KEEP"]
      );
    });
});

testAsync("business units come from the Oracle list and skip inactive units", function () {
  return oracle
    .listBusinessUnits({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      fetch: function (url) {
        var parsed = new URL(url);
        assert.ok(parsed.pathname.indexOf("finBusinessUnitsLOV") !== -1);
        assert.strictEqual(parsed.pathname.indexOf("invoiceHolds"), -1);
        return jsonResult(200, {
          items: [
            { BusinessUnitName: "Vision Operations", ActiveFlag: true },
            { BusinessUnitName: "Closed Unit", ActiveFlag: false },
            { BusinessUnitName: "Canada Business Unit", ActiveFlag: "Y" },
            { BusinessUnitName: "Vision Operations", ActiveFlag: true },
          ],
          hasMore: false,
        });
      },
    })
    .then(function (result) {
      assert.strictEqual(result.source, "lov");
      assert.deepStrictEqual(result.businessUnits, ["Canada Business Unit", "Vision Operations"]);
    });
});

testAsync("a missing business unit list falls back to distinct open holds", function () {
  var sawHolds = false;
  return oracle
    .listBusinessUnits({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      fetch: function (url) {
        var parsed = new URL(url);
        if (parsed.pathname.indexOf("finBusinessUnitsLOV") !== -1) {
          return jsonResult(404, { title: "Not Found" });
        }
        sawHolds = true;
        assert.strictEqual(parsed.searchParams.get("q"), "ReleaseName IS NULL");
        assert.strictEqual(parsed.searchParams.get("fields"), "BusinessUnit");
        return jsonResult(200, {
          items: [
            { BusinessUnit: "US1 Business Unit" },
            { BusinessUnit: "US1 Business Unit" },
            { BusinessUnit: "UK Business Unit" },
          ],
          hasMore: false,
        });
      },
    })
    .then(function (result) {
      assert.strictEqual(sawHolds, true);
      assert.strictEqual(result.source, "holds");
      assert.deepStrictEqual(result.businessUnits, ["UK Business Unit", "US1 Business Unit"]);
    });
});

testAsync("sample mode lists business units and filters holds for the selected unit", function () {
  var app = server.createApp({ env: {}, fetch: function () {
    throw new Error("Oracle must not be called");
  } });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return getJson(httpServer, "/api/business-units");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body.mode, "sample");
      assert.deepStrictEqual(result.body.businessUnits, [
        "Canada Business Unit",
        "UK Business Unit",
        "US1 Business Unit",
        "Vision Operations",
      ]);
      return getJson(httpServer, "/api/holds?businessUnit=" + encodeURIComponent("Canada Business Unit"));
    })
    .then(function (result) {
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body.businessUnit, "Canada Business Unit");
      assert.ok(result.body.holds.length > 0);
      assert.ok(result.body.holds.every(function (hold) {
        return hold.businessUnit === "Canada Business Unit";
      }));
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("the business unit endpoint uses the same access gate", function () {
  var previous = process.env.APP_ACCESS_PASSWORD;
  process.env.APP_ACCESS_PASSWORD = "gate-secret";
  var denied = mockResponse();
  return Promise.resolve(
    businessUnitsApi({ method: "GET", url: "/api/business-units", headers: {} }, denied)
  )
    .then(function () {
      assert.strictEqual(denied.statusCode, 401);
      assert.strictEqual(denied.body.indexOf("gate-secret"), -1);
      var ok = mockResponse();
      return businessUnitsApi(
        {
          method: "GET",
          url: "/api/business-units",
          headers: { authorization: basicHeader("x", "gate-secret") },
        },
        ok
      ).then(function () {
        return ok;
      });
    })
    .then(function (ok) {
      var body = JSON.parse(ok.body);
      assert.strictEqual(ok.statusCode, 200);
      assert.strictEqual(body.mode, "sample");
      assert.ok(body.businessUnits.indexOf("Vision Operations") !== -1);
      assert.strictEqual(JSON.stringify(body).indexOf("gate-secret"), -1);
    })
    .finally(function () {
      if (previous === undefined) {
        delete process.env.APP_ACCESS_PASSWORD;
      } else {
        process.env.APP_ACCESS_PASSWORD = previous;
      }
    });
});

test("requestUrl copies Vercel query fields that are missing from the url", function () {
  var url = holds.requestUrl({
    url: "/api/holds",
    query: { includeReleased: "true", businessUnit: ["UK Business Unit"] },
  }, "/api/holds");
  assert.strictEqual(url.pathname, "/api/holds");
  assert.strictEqual(url.searchParams.get("includeReleased"), "true");
  assert.strictEqual(url.searchParams.get("businessUnit"), "UK Business Unit");
  var existing = holds.requestUrl({
    url: "/api/holds?businessUnit=Canada%20Business%20Unit",
    query: { businessUnit: "Other" },
  }, "/api/holds");
  assert.strictEqual(existing.searchParams.get("businessUnit"), "Canada Business Unit");
});

testAsync("Vercel query fields still select the business unit when the url omits them", function () {
  var res = mockResponse();
  var req = {
    method: "GET",
    url: "/api/holds",
    query: { businessUnit: "Canada Business Unit", includeReleased: "false" },
  };
  return holds.handleHolds(holds.requestUrl(req, "/api/holds"), {}, function () {
    throw new Error("Oracle must not be called");
  }, res).then(function () {
    var body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.mode, "sample");
    assert.notStrictEqual(body.mode, "live");
    assert.strictEqual(body.businessUnit, "Canada Business Unit");
    assert.ok(body.holds.length > 0);
    assert.ok(body.holds.every(function (hold) {
      return hold.businessUnit === "Canada Business Unit";
    }));
  });
});

testAsync("an Oracle rejection stays a live error and hides the Oracle body", function () {
  var res = mockResponse();
  return holds.handleHolds(
    new URL("http://127.0.0.1/api/holds"),
    {
      ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: "oracle-secret",
    },
    function (url, options) {
      assert.strictEqual(options.method, "GET");
      assert.strictEqual(String(url).indexOf("oracle-secret"), -1);
      return jsonResult(401, { detail: "oracle-secret leaked in body" });
    },
    res
  ).then(function () {
    var body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.mode, "live");
    assert.strictEqual(body.holds, undefined);
    assert.strictEqual(JSON.stringify(body).indexOf("oracle-secret"), -1);
    assert.strictEqual(JSON.stringify(body).indexOf("leaked"), -1);
  });
});

testAsync("a transport error does not copy the Oracle password or the target url", function () {
  return oracle.loadHolds({
    baseUrl: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
    user: "fin_impl",
    password: "oracle-secret",
    includeReleased: false,
    fetch: function (url, options) {
      assert.strictEqual(options.method, "GET");
      assert.strictEqual(options.body, undefined);
      assert.strictEqual(String(url).indexOf("oracle-secret"), -1);
      return Promise.reject(new Error("connect failed https://evil.example/oracle-secret"));
    },
  }).then(function () {
    throw new Error("expected transport failure");
  }).catch(function (err) {
    if (err && err.message === "expected transport failure") {
      throw err;
    }
    assert.strictEqual(err.kind, "network");
    assert.ok(err.message.indexOf("Could not reach") !== -1);
    assert.strictEqual(String(err.message).indexOf("oracle-secret"), -1);
    assert.strictEqual(String(err.message).indexOf("evil.example"), -1);
  });
});

testAsync("pages and the API send no-store security headers", function () {
  var app = server.createApp({ env: {} });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/");
    })
    .then(function (response) {
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.strictEqual(response.headers.get("x-content-type-options"), "nosniff");
      assert.strictEqual(response.headers.get("x-frame-options"), "DENY");
      return response.text().then(function (html) {
        assert.ok(html.indexOf("Invoice hold triage") !== -1);
        assert.strictEqual(html.indexOf("ORACLE_FUSION_PASSWORD") !== -1, false);
        return fetch("http://127.0.0.1:" + httpServer.address().port + "/api/holds");
      });
    })
    .then(function (response) {
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.strictEqual(response.headers.get("x-content-type-options"), "nosniff");
      return response.json();
    })
    .then(function (body) {
      assert.strictEqual(body.mode, "sample");
      assert.notStrictEqual(body.mode, "live");
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("a release date without a release name stays in the open set", function () {
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: true,
      fetch: function (url) {
        var parsed = new URL(url);
        var q = parsed.searchParams.get("q");
        if (parsed.pathname.indexOf("invoiceHolds") !== -1) {
          if (q === "ReleaseName IS NULL") {
            return jsonResult(200, {
              items: [
                {
                  HoldId: "D-1",
                  InvoiceNumber: "D-1",
                  Supplier: "Dated Supplier",
                  BusinessUnit: "Vision Operations",
                  ReleaseName: null,
                  ReleaseDate: "2026-04-01T00:00:00+00:00",
                  HoldDate: "2026-03-01T00:00:00+00:00",
                  HoldName: "Price",
                  links: [parentLink(31)],
                },
              ],
              hasMore: false,
              limit: 500,
              offset: 0,
            });
          }
          assert.strictEqual(q, "ReleaseName IS NOT NULL");
          return jsonResult(200, { items: [], hasMore: false, limit: 500, offset: 0 });
        }
        return jsonResult(200, {
          InvoiceId: 31,
          InvoiceNumber: "D-1",
          BusinessUnit: "Vision Operations",
          Supplier: "Dated Supplier",
          InvoiceAmount: 5,
          InvoiceCurrency: "USD",
        });
      },
    })
    .then(function (result) {
      assert.strictEqual(result.holds.length, 1);
      assert.strictEqual(result.holds[0].holdId, "D-1");
      assert.strictEqual(result.holds[0].released, false);
      assert.strictEqual(result.holds[0].releaseDate, "2026-04-01");
      assert.ok(result.warning.indexOf("release date and no release name") !== -1);
    });
});

testAsync("open cap warnings use the fetched count, not the filtered count", function () {
  return oracle
    .loadHolds({
      baseUrl: "https://fa-example.example.com",
      user: "fin_impl",
      password: "pw",
      includeReleased: false,
      openCap: 2,
      businessUnit: "Vision Operations",
      fetch: function (url) {
        var parsed = new URL(url);
        if (parsed.pathname.indexOf("invoiceHolds") === -1) {
          return jsonResult(200, {
            InvoiceId: 21,
            InvoiceNumber: "KEEP",
            InvoiceAmount: 3,
            InvoiceCurrency: "USD",
            BusinessUnit: "Vision Operations",
            Supplier: "Kept",
          });
        }
        assert.strictEqual(parsed.searchParams.get("limit"), "2");
        return jsonResult(200, {
          items: [
            openHold("KEEP", 21),
            Object.assign(openHold("DROP", 22), { BusinessUnit: "Other Unit" }),
          ],
          hasMore: true,
          limit: 2,
          offset: 0,
        });
      },
    })
    .then(function (result) {
      assert.strictEqual(result.holds.length, 1);
      assert.strictEqual(result.holds[0].invoiceNumber, "KEEP");
      assert.ok(result.warning.indexOf("Fetched the first 2 open holds") !== -1);
      assert.ok(result.warning.indexOf("Showing 1 of them") !== -1);
      assert.strictEqual(result.warning.indexOf("first 1"), -1);
      assert.strictEqual(result.warning.indexOf("Only released"), -1);
    });
});

testAsync("live Oracle without an access password fails closed and does not call Oracle", function () {
  var oracleCalls = 0;
  var app = server.createApp({
    env: {
      ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: "oracle-secret",
    },
    fetch: function () {
      oracleCalls += 1;
      throw new Error("Oracle must not be called");
    },
  });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return getJson(httpServer, "/api/holds");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 503);
      assert.ok(String(result.body).indexOf("config-required") !== -1);
      assert.strictEqual(String(result.body).indexOf("oracle-secret"), -1);
      return getJson(httpServer, "/api/business-units");
    })
    .then(function (result) {
      assert.strictEqual(result.status, 503);
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/");
    })
    .then(function (response) {
      assert.strictEqual(response.status, 503);
      return response.text();
    })
    .then(function (text) {
      assert.ok(text.indexOf("config-required") !== -1);
      assert.strictEqual(oracleCalls, 0);
      var res = mockResponse();
      return holdsApi(
        { method: "GET", url: "/api/holds", headers: {} },
        res,
        {
          ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
          ORACLE_FUSION_USER: "fin_impl",
          ORACLE_FUSION_PASSWORD: "oracle-secret",
        }
      ).then(function () {
        assert.strictEqual(res.statusCode, 503);
        assert.ok(res.body.indexOf("config-required") !== -1);
        assert.strictEqual(res.headers["WWW-Authenticate"], undefined);
        assert.strictEqual(oracleCalls, 0);
      });
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("HEAD does not call Oracle on the holds or business unit API", function () {
  var oracleCalls = 0;
  var env = {
    APP_ACCESS_PASSWORD: "gate-secret",
    ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
    ORACLE_FUSION_USER: "fin_impl",
    ORACLE_FUSION_PASSWORD: "oracle-secret",
  };
  var app = server.createApp({
    env: env,
    fetch: function () {
      oracleCalls += 1;
      throw new Error("Oracle must not be called");
    },
  });
  var httpServer;
  return listen(app)
    .then(function (started) {
      httpServer = started;
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/api/holds", {
        method: "HEAD",
        headers: { Authorization: basicHeader("anyone", "gate-secret") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 405);
      assert.strictEqual(response.headers.get("allow"), "GET");
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/api/business-units", {
        method: "HEAD",
        headers: { Authorization: basicHeader("anyone", "gate-secret") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 405);
      return fetch("http://127.0.0.1:" + httpServer.address().port + "/", {
        method: "HEAD",
        headers: { Authorization: basicHeader("anyone", "gate-secret") },
      });
    })
    .then(function (response) {
      assert.strictEqual(response.status, 200);
      assert.strictEqual(oracleCalls, 0);
      var res = mockResponse();
      return holdsApi(
        {
          method: "HEAD",
          url: "/api/holds",
          headers: { authorization: basicHeader("x", "gate-secret") },
        },
        res,
        env
      ).then(function () {
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(res.headers.Allow, "GET");
        assert.strictEqual(res.body, "Method not allowed");
        assert.strictEqual(oracleCalls, 0);
      });
    })
    .finally(function () {
      if (httpServer) {
        httpServer.close();
      }
    });
});

testAsync("edge middleware fails closed when live Oracle has no access password", function () {
  return import("./middleware.js").then(function (mod) {
    var live = {
      ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
      ORACLE_FUSION_USER: "fin_impl",
      ORACLE_FUSION_PASSWORD: "oracle-secret",
      APP_ACCESS_PASSWORD: "",
    };
    var blocked = mod.decideRequest(live, null);
    assert.strictEqual(blocked.status, 503);
    assert.ok(blocked.message.indexOf("config-required") !== -1);
    assert.strictEqual(blocked.message.indexOf("oracle-secret"), -1);
    assert.strictEqual(mod.decideRequest({}, null), null);
    var partial = {
      ORACLE_FUSION_URL: "https://ibcrqy-test.fa.ocs.oraclecloud.com",
      ORACLE_FUSION_USER: "fin_impl",
    };
    assert.strictEqual(mod.decideRequest(partial, null), null);
    var allowed = mod.decideRequest(
      Object.assign({}, live, { APP_ACCESS_PASSWORD: "gate" }),
      basicHeader("a", "gate")
    );
    assert.strictEqual(allowed, null);
  });
});

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead: function (status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end: function (body) {
      this.body = body || "";
    },
  };
}

if (pending === 0) {
  finish();
}
