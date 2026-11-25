# Reyma / Carvajal — reusable furgón packer and capacity from `modelo_proveedor`

**Date:** 2026-11-12
**Scope:** The live Reyma model and the Carvajal page that reuses it (`VivoClient`, modelo `reyma` and `carvajal`). The weekly dispatch plan (MRP + furgón bin-packing) and the parameters that feed it.
**Stack:** Next.js, TypeScript, Supabase (`modelo_proveedor`, `reyma_plan_despacho`). No new migration.
**Trigger:** Finish the existing Reyma/Carvajal packer, stop the silent 100 m³ fallback, and extract a pure packing function that later models can call. Do not apply it to local replenishment or to Darnel/Asia yet.

This session did not run the test suite, did not start `next dev`, and did not open a browser. Nothing in the change writes to Odoo: no purchase orders, stock moves, or other Odoo documents are created or updated. Saving a plan still writes only to Supabase `reyma_plan_despacho`, which is the path that already existed.

---

## Summary of changes

| Category | Items |
|---|---|
| New pure module | 1 (`packLines.ts`) |
| Modified planner | 1 (`planificacion.ts` — `generarPlan` now delegates) |
| Modified live page | 1 (`VivoClient.tsx`, shared by Reyma and Carvajal) |
| Modified payload type | 1 (`types.ts` — `capacidadM3` is `number \| null`) |
| Modified API route | 1 (`GET /api/compras-internacionales/reyma`) |
| Modified unit tests | 1 (`planificacion.test.ts`; cases added, suite not executed) |
| SQL migrations | 0 |
| Local replenishment, Darnel, Asia | 0 |
| Odoo write paths | 0 |

---

## What was asked

1. **Carvajal capacity.** Stop substituting 100 m³ when `modelo_proveedor.capacidad_m3` is null. Read capacity for the active model. If Carvajal’s capacity is null, show a clear warning and refuse to pack until a capacity is set.
2. **Extract the packer.** Move the core of `generarPlan` into a pure function, `packLines`, that receives lines, a capacity in m³, and optional day and max-per-day settings. The return value is the object stored in `reyma_plan_despacho`. The existing Reyma/Carvajal “Generar plan” button must call this function and, for the same inputs, produce the same plan.
3. **Parameters from the model.** Capacity, dispatch days, and daily max come from `modelo_proveedor` instead of hard-coded fallbacks.
4. **Leave the rest alone.** No UI for other models. No changes to local replenishment or to Darnel/Asia. No writes to Odoo.

---

## 1. `packLines` — the extracted packer

**New file:** `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/packLines.ts`

The function is pure. It does not read the database, does not write anywhere, and does not assume 100 m³ or Reyma’s calendar. `planificacion.ts` re-exports `packLines`, `PackLine`, `PackSettings`, and `PlanDespachoPayload` so existing imports of the planner module can reach it.

### Signature

```typescript
function packLines(
  lines: PackLine[],
  capacidad_m3: number,
  settings?: PackSettings,
): PlanDespachoPayload
```

```typescript
interface PackLine {
  codigo: string;
  cajas: number;
  m3_por_caja: number;
  semanas_cobertura: number;
}

interface PackSettings {
  dias?: string[];                 // dispatch days, in fill order
  max_por_dia?: number;            // furgones allowed on each of those days
  cod_furgon_completo?: string | null; // dedicated full-truck SKU; Reyma VT10 = 77201046
}

interface PlanDespachoPayload {
  dias: Array<{
    dia: string;
    furgones: Array<{ no: number; lineas: Array<{ codigo: string; cajas: number }> }>;
  }>;
  sinDia: Array<{ no: number; lineas: Array<{ codigo: string; cajas: number }> }>;
}
```

`cod_furgon_completo` is optional. Callers without a dedicated SKU omit it and every line is packed in the shared trucks. Reyma still passes `77201046`, which is what keeps VT10 on its own trucks. Without that argument the Reyma plan would change.

### Return shape

The return value is the payload currently stored in `reyma_plan_despacho.payload` (see `supabase/migrations/20260805000003_reyma_l3_writepaths.sql` and the save body in `VivoClient`):

- `dias`: one entry per requested dispatch day, in the order given, including days that received no truck.
- Each furgón is `{ no, lineas: [{ codigo, cajas }] }`.
- `sinDia`: furgones that did not fit in `dias.length × max_por_dia`.

Display fields (supplier key, description, cubicaje, dedicado, m³, percent full) are not part of the stored payload. `generarPlan` joins them back for the screen. Hand-edits of box counts still happen on the screen before save; `packLines` returns the plan before those edits. The save button still builds the payload from the edited cards, so a saved plan can differ from the raw function output after the user changes quantities. That was already the case.

### Rules, unchanged from the previous `generarPlan`

1. Drop lines with `cajas <= 0` or `m3_por_caja <= 0`.
2. Sort the rest by `semanas_cobertura` ascending (lowest coverage first). Sort is stable, so ties keep input order.
3. If `cod_furgon_completo` is set and the line’s `codigo` matches it:
   - `porFurgon = floor(capacidad_m3 / m3_por_caja)`.
   - Open dedicated furgones of exactly `porFurgon` boxes until the remainder is smaller than one full truck.
   - The leftover boxes are not packed. The caller (`generarPlan`) emits the existing aviso: `{codigo}: {resto} cajas fuera de múltiplo de furgón completo — verificar W del motor`.
   - The next product opens a new furgón. Dedicated trucks are never mixed with other SKUs.
4. Otherwise fill the current furgón. Boxes that do not fit are split onto the next furgón. A product is not dropped.
5. Day assignment, only when both `dias` (non-empty) and `max_por_dia` (finite and `> 0`) are present: furgón `i` gets `dias[floor(i / max_por_dia)]` while `i < dias.length * max_por_dia`. The rest go to `sinDia`.
6. If days or the daily max are omitted, every furgón is returned in `sinDia` and `dias` is empty (or only the day names that were passed, with no trucks on them when the max is missing). The function does not invent Lunes–Viernes or a max of 3.

`capacidad_m3` must be a finite number greater than zero. `0` and `NaN` throw `packLines: capacidad_m3 debe ser un número mayor que cero`. The screen never calls the function in that state.

The previous hang when a single box is larger than the truck (`floor(espacio / m3_por_caja) < 1` on an empty truck) is still there. It was not changed, because changing it would change results for an input the old function never returned from.

---

## 2. `generarPlan` now calls `packLines`

**File:** `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/planificacion.ts`

`generarPlan(mrpRows, opts)` is still the function the “Generar plan” button calls. Its public result is still `PlanResult`: `{ furgones: PlanFurgon[], avisos: string[] }`, with the same card fields (`cod`, `clave`, `desc`, `cajas`, `cubicaje`, `m3`, `dedicado`, `dia`, totals, `pct`).

What it does now:

1. Map each MRP row to a `PackLine`: `codigo = cod`, `cajas = w ?? 0`, `m3_por_caja = m`, `semanas_cobertura = l`. Remember the first row’s supplier key, description, and cubicaje per code for the cards.
2. Call `packLines` with `opts.capacidadM3`, `opts.dias`, `opts.maxPorDia`, and `opts.codFurgonCompleto`.
3. Rebuild `PlanFurgon[]` by walking `packed.dias` in order and then `packed.sinDia`. A furgón is marked `dedicado` when it has a single line, that line is the dedicated code, and the box count equals `floor(capacidad / cubicaje)`. That is exactly how dedicated trucks are built.
4. Rebuild avisos:
   - Dedicated remainder, one message per source row of the dedicated code that has `w > 0` and `m > 0`, in coverage order. The text is the same string as before.
   - If any furgón has `dia === null`, the same weekly-cap aviso, including the Wilmer shared-reception sentence, using the days and max that were passed in.

`DIAS_DEFAULT` (`['Lunes', 'Martes', 'Miércoles', 'Viernes']`) is still exported. The screen no longer uses it as the initial checkbox state. The pure function does not use it as a fallback either.

`mrpRegional` now accepts `capacidadM3: number | null`. `furgonesEstimados` is `number | null`. A positive finite capacity still does `Math.ceil(totalM3 / capacidadM3)`. Null, non-finite, or non-positive capacity yields `null` instead of dividing (which previously produced `Infinity` if a caller passed `0`, or a count based on 100 m³ if the API had substituted 100).

The local `Candidato` type and the in-function bin-packing loop were removed from `generarPlan`. The loop lives in `packLines`.

---

## 3. Capacity, days, and daily max come from `modelo_proveedor`

**File:** `frontend/src/app/api/compras-internacionales/reyma/route.ts`
**Type:** `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/types.ts`

`GET /api/compras-internacionales/reyma?modelo=` already loaded `modelo_proveedor`. Before this change:

| Field | Previous behavior |
|---|---|
| `config.capacidadM3` | `capacidad_m3`, or the constant `CAPACIDAD_M3 = 100` when the column was null or the row was missing |
| `modelo.diasDespacho` | passed through, including null, but the screen ignored it and started from `DIAS_DEFAULT` |
| `modelo.maxFurgonesDia` | passed through, including null, but the screen ignored it and started at `3` |
| `config.codFurgonCompleto` | `cod_comodin`, or `'77201046'` when null |

`CAPACIDAD_M3` was deleted. `config.capacidadM3` is now `numeroONull(capacidad_m3)` and its type is `number | null`. Null stays null. A Postgres `NUMERIC` that arrives as the string `"100.00"` becomes the number `100`, which is the same quantity the packer used when the value was already numeric.

`numeroONull` treats `null`, `undefined`, `''`, and non-finite values as null. `diasONull` keeps a non-empty string array and turns a missing or empty array into null. Both are applied to the packing parameters:

- `config.capacidadM3` ← `capacidad_m3`
- `modelo.maxFurgonesDia` ← `max_furgones_dia`
- `modelo.diasDespacho` ← `dias_despacho`
- `modelo.furgonesSemana` ← `furgones_semana` (coerced the same way; the packer does not use this column)

Seeded values that already exist (migration `20260901000011_modelo_proveedor.sql`, `ON CONFLICT DO NOTHING`):

| Slug | `capacidad_m3` | `dias_despacho` | `max_furgones_dia` |
|---|---|---|---|
| `reyma` | 100 | Lunes, Martes, Miércoles, Viernes | 6 |
| `carvajal` | NULL | NULL | NULL |

`cod_comodin` still falls back to `'77201046'` when the column is null. That fallback was left in place. It is the measured full-truck rule from Alexis’s workbook, not a volume. Reyma’s row already stores `77201046`, so the live Reyma call sends the same code as before. Carvajal’s `cod_comodin` is null, so the API still sends VT10, but the MRP floor that uses it is skipped while capacity is missing (see below). When a capacity is later saved for Carvajal, that VT10 floor will apply again for SKU `77201046` if it is in scope.

No editor was added for `modelo_proveedor`. Capacity is set on the row, not on this screen.

---

## 4. Screen — `VivoClient`

**File:** `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/VivoClient.tsx`

The same component serves `/compras-internacionales/reyma-vivo` and `/compras-internacionales/carvajal-vivo`. There is no new page and no new model.

### When packing is allowed

`capacidadUsable` is true only for a finite number `> 0`. “Generar plan” is enabled only when all three are present:

- a usable capacity,
- at least one dispatch day checked,
- a daily max `>= 1`.

Otherwise the button is disabled (slate, `cursor-not-allowed`) and `generar()` returns without calling `generarPlan`. The click handler also clears any in-progress plan if it is invoked without those inputs.

### Where the controls start

- Days: `modelo.diasDespacho`, kept only if the name is one of Lunes, Martes, Miércoles, Jueves, Viernes, and ordered in that weekday sequence. An empty or null list leaves every box unchecked. Reyma’s stored list is Lunes, Martes, Miércoles, Viernes, which is `DIAS_DEFAULT`, so the checkboxes open the same way they did before.
- Daily max: `modelo.maxFurgonesDia` when it is a positive finite number, otherwise empty (`null`, placeholder `—`). Clearing the input sets it back to empty. It no longer snaps to 3.
- The input ceiling is `max(6, model max)`. Reyma’s ceiling stays 6, which is the previous `max={6}`. A model whose stored max is higher than 6 can type up to that stored max.

Thursday still shows the existing footnote that it is excluded by preference for the Reyma arrival rule. The checkbox list itself was not redesigned.

### Warnings

If capacity is missing, an amber banner under the sync line names the model and `modelo_proveedor.capacidad_m3`, and says the dispatch plan will not be built until that capacity is loaded. The plan panel repeats a shorter version of the same warning.

The panel also warns when no day is checked (“Días de despacho sin definir. Marca al menos un día…”) and when the daily max is empty (“Máximo de furgones por día sin definir.”).

The panel title uses the real capacity (`furgón de {cap} m³`) or `capacidad de furgón sin definir`. It no longer hard-codes “bin-packing 100 m³”.

### Places that used to divide by 100 m³

When capacity is missing, these surfaces show cubic meters and the text “capacidad sin definir” (or “capacidad de furgón sin definir”). They do not invent a furgón count:

- Header KPI “Volumen pedido (m³ / furgones)”.
- Regional MRP badge (Zacapa, Petén, Zona 11), via `mrpRegional(..., null)`.
- Monthly order badge and the printable order total.
- Supplier sheet header (“Capacidad por furgón”), if a plan is printed.
- Furgón card fill percent. The percent and the red overflow color are omitted when there is no capacity, so the UI does not divide by null.

### MRP engine when capacity is missing

`computeMrp` in `reyma/engine.ts` was not modified. The workbook parity path still receives a numeric capacity. The live page, when capacity is missing, passes `capacidadM3: 1` and `codFurgonCompleto: '\u0000'` so the dedicated-SKU floor (`floor(cap / cubicaje)` on VT10) does not run against a fake 100 m³. With the sentinel code, that capacity is not applied to any real SKU. “Cajas a despachar” for ordinary rows is still the unfloored weekly order, which is what the engine already did whenever the code was not the dedicated SKU.

When capacity is usable, the page passes the real capacity and the real `codFurgonCompleto`. For Reyma that is 100 and `77201046`, the same pair the page used before.

---

## 5. Reyma behavior with the current capacity and days

`generarPlan` / `packLines`, called with:

- `capacidad_m3 = 100`
- days = Lunes, Martes, Miércoles, Viernes
- `max_por_dia = 3`
- `cod_furgon_completo = 77201046`

produces the same plan the previous `generarPlan` produced for those inputs:

- lowest coverage first;
- a product that does not fit is split, and no boxes of a normal product are dropped;
- VT10 goes out in dedicated trucks of `floor(100 / cubicaje)` boxes (629 boxes at cubicaje `0.15898`);
- a remainder that does not fill one more dedicated truck is left out, with the same aviso;
- days are assigned in order, 3 furgones per day, and overflow furgones have `dia = null` plus the Wilmer cupo aviso.

Those are the inputs in `planificacion.test.ts` (`OPTS`). The previous assertions were left in place. New assertions check that `packLines`’s payload projects onto the same furgón numbers, days, and `{ codigo, cajas }` lines as `generarPlan`, that omitted day settings leave the truck in `sinDia`, that capacity `0` and `NaN` throw, that a 630-box VT10 order warns about the 1 leftover box, and that `mrpRegional(..., null)` keeps the box math and returns `furgonesEstimados = null`.

The suite was not executed in this session.

### What a fresh click on Reyma does now

Reyma’s row has capacity 100 and the same four days, so the contents of each furgón on “Generar plan” match the previous packer.

Reyma’s `max_furgones_dia` is **6**. The control used to open at **3** (described in `planificacion.ts` as Reyma’s practical half of the 6/day reception shared with Wilmer; the seed stored 6 as that shared ceiling). The field now opens at 6. A click that does not edit the field places up to 6 furgones on each day instead of 3. Which boxes sit in which furgón does not change, because that depends on capacity, coverage order, cubicaje, and the dedicated code. The day label on each furgón does change, and fewer furgones fall into “SIN DÍA”, unless the field is set back to 3 (on the control for that session, or on `modelo_proveedor.max_furgones_dia` if 3 should be the stored operating max).

---

## 6. Carvajal

Carvajal already renders `VivoClient` with `modelo="carvajal"`. No second packer and no new screen were added.

With the seeded row (`capacidad_m3`, `dias_despacho`, and `max_furgones_dia` all null):

- The amber capacity banner is visible on the page.
- The plan panel repeats the warning, leaves the day boxes unchecked, leaves the daily max empty, and disables “Generar plan”.
- KPI, regional MRP, and the monthly order show m³ without a furgón count derived from 100.
- The MRP dedicated-SKU floor is not applied against 100 m³.

Packing stays refused until `modelo_proveedor.capacidad_m3` is a positive number. Days and the daily max can be chosen on the existing controls for that session; they are not pre-filled from Reyma. All three are required before the button enables, so choosing days and a max is not enough while capacity is still null.

---

## 7. What was deliberately not changed

- Local replenishment (`compras/reabastecimiento` and related cubicaje / sugerido code).
- Darnel and Asia (`reorden` motor, `ReordenClient`, their `modelo_proveedor` rows).
- `reyma/engine.ts` workbook formulas (`computeMrp`, parity path, `ReymaClient`).
- The plan POST (`/api/compras-internacionales/reyma/plan`) and the `reyma_plan_despacho` table.
- Odoo sync and any Odoo create/update.
- `cod_comodin` fallback to VT10 when the column is null (see section 3).
- The supplier-sheet title still says “LÍNEA REYMA”. That string was already shared by the Carvajal page.
- No settings UI was added for other models, and no migration was written to change Reyma’s stored max from 6 to 3.

---

## Files

| Path | Change |
|---|---|
| `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/packLines.ts` | New. Pure `packLines`. |
| `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/planificacion.ts` | `generarPlan` delegates. `mrpRegional` accepts a null capacity. Re-exports the packer. |
| `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/VivoClient.tsx` | Reads model parameters, warns, and refuses to pack without a capacity. |
| `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/types.ts` | `config.capacidadM3: number \| null`. |
| `frontend/src/app/api/compras-internacionales/reyma/route.ts` | Drops the 100 m³ fallback. Coerces capacity, days, and daily max from the model row. |
| `frontend/src/app/(authenticated)/compras-internacionales/reyma-vivo/__tests__/planificacion.test.ts` | Locks payload shape, null capacity, and the VT10 remainder aviso. Not executed this session. |
