# Sugerido Excel — the download died at about a hundred rows

**Date:** 2026-11-24
**Scope:** The workbook writer shared by «Exportar Excel» on reabastecimiento vivo and by the commercial forecast export. The ZIP container only. The sheet XML, the columns, the filters, and the row set are the same.
**Stack:** TypeScript, client-side, `frontend/src/lib/xlsx/writer.ts`. No API change, no migration, no Odoo write.
**Trigger:** Wilmer, in the abastecimiento chat, 24 Nov around 11:43–11:52. He cannot download many lines to Excel. The app stops him at very few. He needs the file now to abastecer Zacapa: sum the warehouse’s pedido with the forecast, because that capture has not been trained, and he does it with a VLOOKUP. The button answers `⚠ Maximum call stack size exceeded`. Luis Roberto has asked him to work only in the app. He still has to prepare a traslado, and without the file he cannot.

This session did not run the Jest suite, did not start `next dev`, and did not open a browser. One Node check compared a small archive with the previous header layout and packed a 1,500-row sheet. Nothing here writes to Odoo or to Supabase.

The commit was not made in this session. The stage command and the message are in the conversation that wrote this file.

---

## Summary of changes

| Category | Items |
|---|---|
| Writer | `zip` in `frontend/src/lib/xlsx/writer.ts`. Bytes are copied with `Uint8Array.set` into one buffer. The spread of each part into `push` is gone. |
| Regression | One case in `frontend/src/lib/xlsx/__tests__/writer.test.ts`. A 400-row, 28-column sheet must come back as a ZIP and must still contain the last row. The suite was not executed. |
| Callers | Unchanged. `ExportarExcel` and `ExportarForecast` already call `buildWorkbook`. Both pick up the new `zip`. |
| Screen cap | Unchanged. The grid still paints the first 400 rows (`MAX_FILAS_RENDER`). The file was already supposed to carry every filtered row. |
| Database | Unchanged. `fetchAll` still pages PostgREST at 1,000 rows on a unique key. No `DISTINCT ON`, no `COPY`, no new export route. |
| Odoo | Unchanged. The file is still a download. Nothing is posted to a purchase order or an internal transfer. |

`writer.ts` and `writer.test.ts` together are +128 / −33.

---

## What was asked

1. **Find the cause.** The screenshot is the error the button already prints: `⚠` plus `Error.message`.
2. **Read how a database is supposed to serve a case like this.** Large extracts, `OFFSET`, latest-row-per-key, and where a VLOOKUP belongs.
3. **Fix the failure.** The proposal that was implemented is the writer. The 400-row window and the capture that would retire the VLOOKUP were left as they are.
4. **Do not run the local suite or the dev server.**

---

## 1. What he was doing

Zacapa is resupplied from San José, and Petén from Zacapa. On the Zacapa tab the grid already shows San José and Zona 11 stock and days on hand, so a traslado can be chosen without leaving the tab. «Pide bodega» and the approved commercial forecast already sum into Adicionales and into Sugerido for the warehouse on screen.

The quantity he was adding by hand is the one the warehouse has not been typing. He exports the sheet, VLOOKUPs that pedido onto it, and pastes into Odoo. Bulk import is off, so the workbook is the path into the transfer. A download that dies at a hundred rows blocks that path. The message he pasted is the string `ExportarExcel` sets when `buildWorkbook` throws.

The grid’s own limit is a different sentence. It renders `list.slice(0, 400)` and tells him to refine the filters. The button’s contract, since the 26 Aug rewrite, is the opposite: the file takes every filtered row, and it says so when the screen is clipped. The throw happened before that file could exist.

---

## 2. Where it threw

`sheetXml` builds one string with `map` and `join`. That is not a deep call. The throw was in `zip`, which turned the worksheet into a JavaScript argument list:

```ts
local.push(
  ...headerFields,
  ...name,
  ...e.data,   // one argument per byte of the sheet
);
return new Uint8Array([...local, ...central, ...end]);
```

A spread into a call uses one stack slot per element. There is no recursion. V8 dies somewhere near 125,000 arguments at the top of a script, and sooner inside a click handler. JavaScriptCore, in Safari, stops at 65,536 arguments. The message in either engine is `Maximum call stack size exceeded`.

Measured on this machine, before the change, with a 28-column sheet of the Zacapa shape (Suma: local columns plus San José and Zona 11, channels folded). `buildWorkbook` succeeded at 103 rows, 118,530 bytes of sheet XML, and threw that exact message at 104 rows, 119,672 bytes. A tight filter downloaded. The bodega did not. General’s input table was 1,337 rows the day the pager was fixed (9 Sep); the active catalog around then was about 1,670 products. “Muy pocas” is that hundred-row ceiling.

The unit tests built one- and two-row workbooks, so they stayed under the limit. The forecast export calls the same `buildWorkbook`, so a long forecast would have died in the same place.

The rows were already in the browser. `GET /api/compras/reabastecimiento` builds them with `fetchAll`, which pages PostgREST past its 1,000-row cap and orders by a unique column so a page boundary cannot duplicate one product and drop another. That bug had already removed a SKU from a purchase order. This export did not hit it again. The click failed while packing bytes the query had already returned.

`COPY` and a server cursor are the right tools when the result does not fit in memory or the file is a pure SQL projection. This workbook is the replenishment engine plus the live Odoo reserve, and it has to match the grid. A full Zacapa file is on the order of 2 MB. The practice that fits that size is one row set and a writer that can hold it. A second export query is how the 26 Aug file shipped the wrong warehouse and the wrong codes. Latest-capture-per-key (`DISTINCT ON (product_id, bodega) … ORDER BY id DESC`, index `(product_id, bodega, id DESC)`) is the shape of his VLOOKUP, and it is how `consolidarSugeridoBodega` already folds rows that were typed. That fold was not moved into SQL. The tables are still read in full and reduced in the route.

---

## 3. The writer

`zip` still writes a STORE archive: method 0, UTF-8 flag `0x0800`, version 20, DOS timestamp fixed at 1980-01-01 so the same input is the same bytes. Local header 30 bytes, central header 46, end record 22, no extra field and no comment.

It now counts those sizes, allocates one `Uint8Array`, and copies each name and each part with `set`. Little-endian `putU16` / `putU32` write the same fields the old `u16` / `u32` arrays pushed. If the cursor does not land on `out.length`, it throws `zip: tamaño … distinto de …` instead of returning a short buffer. Assigning past the end of a `Uint8Array` is silent in JavaScript, so the check is the only signal that the size math drifted.

A one-off comparison, not the test suite, packed the same small inputs with the previous algorithm and with this one. `a.txt` / `hello` (113 bytes) matched. A worksheet name with `Código Petén` plus an empty part (283 bytes) matched. A 1,500-row, 28-column workbook then packed: 1,890,806 bytes of sheet XML, 1,895,670 bytes of xlsx, the last SKU present, the end-of-central-directory signature in the last record.

---

## 4. The test that would have caught it

`frontend/src/lib/xlsx/__tests__/writer.test.ts` builds 400 rows by 28 columns, asserts the sheet XML is longer than 200 KB, and requires a ZIP that starts with `PK\x03\x04`, ends with the end-of-central-directory signature, and still contains `SKU-399-0-BOLSA`. STORE leaves that text in the container, so a truncated write fails the assertion even if the signatures are right. The case was not run.

---

## What this session did not change

- The 400-row render cap, the filters, the sort, «Copiar», or the columns Wilmer sees.
- «Pide bodega», the forecast capture, or the sum into Sugerido. The VLOOKUP goes away when that quantity is typed in the grid, not because of this writer.
- `fetchAll`, `buildRows`, and every Supabase query.
- Odoo. No purchase order, stock move, or internal transfer is created.
- The other dirty files already in the tree: Reyma/Carvajal planner, `ml/api.py`, `ml/pendiente_reserva.py`, `OPEN_ITEMS.md`, and the untracked guides. They are not part of this fix.

---

## After it is deployed

The writer runs in the browser, so the fix arrives with the frontend. On Zacapa, **Exportar Excel** with the filter he actually needs should download the whole list. The grid will still say it is showing the first 400. The file is the rest.

His traslado for this morning can go back through the sheet. The standing path, once the warehouse is typing «Pide bodega», is to sort Zacapa by DOH San José and work the blue rows in the app.
