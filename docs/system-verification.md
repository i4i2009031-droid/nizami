# Five-cycle system verification

`run_5x_system_verification.py` is the entry point. It restores the original encoded branding, snapshots the source, runs the complete Node test suite, builds both web bundles, launches actual Chromium against a loopback server, and validates/renders all generated PDF pages with pypdf and Poppler. A failed prerequisite, assertion, source change during execution, or missing PDF is a failed gate. Fewer than five cycles or `--skip-unit` is diagnostic only and cannot set `requiredAutomationPassed`.

## Real components and the transport boundary

The test uses the shipped client HTML, event handlers, forms, IndexedDB transactions, accounting projections, canvas, logo decoding and PDF bytes. It enters records through visible controls and compares the resulting balances against a separate integer-unit oracle. It reads the actual persistent events back for verification and reloads the page at the end of each cycle.

The Android `QatfahNative` transport is an explicit test double. It records the exact target number, request ID, filename, Base64 PDF and caption, and supplies controlled success/error replies. This verifies invocation and zero-pop-up behavior; it does **not** establish authenticated WhatsApp connectivity, phone delivery, Android lifecycle behavior or production signing. `liveWhatsappVerified` and `productionReadinessCertified` remain false. No real contact receives any test message.

## Five independent, different books

Each cycle has its own browser context and tenant database, merchant identity, logo, Yemeni contacts and item prices. Across the five cycles the runner performs:

| Area | Coverage |
|---|---|
| Identity | Five distinct names, logos, addresses and phone values; all are checked in every PDF's actual canvas calls, with PDF bytes parsed and rendered afterwards |
| Catalog | Five primary customers, five suppliers, five items priced in all three currencies, plus five inline party additions that preserve the journal draft |
| Sales | Five cash sales, five credit sales; cash sales create no debt, credit sales add no cash; one cash sale has 12 item rows and spans PDF pages |
| Purchases and vouchers | Five cash purchases, five credit purchases, five receipts, five payments and five expenses |
| Simple journal | Five debit, five credit and five transfer operations **for each currency**, 45 total; cash and book modes, negative balances, and exact two-sided transfers |
| Cash | Five openings per currency, capital deposits, expenses, chronological balances, full invoice source references, currency tabs and future-date carry-forwards; extra distinct movements exercise report pagination |
| Reports | Daily totals, paid/due amounts and counts; annual sales, purchases, expenses, cash movements, receipts, payments and counts compared with independent expected amounts, including values drawn into the actual PDFs |
| PDFs | Nine documents per cycle: invoice, voucher, simple journal, both transfer parties, statement, cashbook, daily sales and annual report; 45 PDF files total |
| Silent send | Exact customer/supplier recipient, one dispatch despite a double click, no new modal/window/share/preview or JavaScript alert/confirm/prompt, no navigation, root preservation, negative response without fallback, and finally-unlocked button |
| Persistence | Five actual IndexedDB reload/readback checks |

Every source and vendored dependency, including encoded branding and restored PNGs, is hashed before and after the run. The final gate requires each named section and all nine PDF types in each cycle, plus exactly five debit, credit and transfer operations per currency. The GitHub Actions verification job runs the same entry point and is a required dependency of both Android and web jobs. Generated accounting fixtures contain synthetic test data and are never written to the merchant's real database.

## Reproduce

Use Node 24, Python 3.12+, the locked npm dependencies, `requirements-verification.txt`, Chromium and Poppler. The default command is:

```bash
python3 run_5x_system_verification.py
```

An already installed Chromium can be selected without downloading another copy:

```bash
python3 run_5x_system_verification.py --chromium /absolute/path/to/chromium --output /absolute/path/to/results
```

The bundled runtime can expose Playwright through `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. CI uses the normal local npm package. A restricted execution environment must permit starting a local browser and a server bound to `127.0.0.1`; the runner never binds a public interface.
