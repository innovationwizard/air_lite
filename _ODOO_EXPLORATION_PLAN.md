# Odoo Live Connection & Truck/Loading Data Investigation

**Date:** 2026-03-26
**Odoo Version:** 17
**Environment:** Test (suplicentro-2801-27990914.dev.odoo.com)

## Context

Credentials for Suplicentro's Odoo 17 test environment were just received. No live Odoo API code exists in the codebase — all current data came from CSV imports. The client's #1 pain point is truck/container loading schedule optimization, but their IT admin doesn't know if the data exists in Odoo. We need to explore first, then build.

## Ground Rules

- **NO sync to production database.** All exploration results are saved locally only (Markdown + JSON files in the repo).
- **All results from all phases** are persisted to `_ODOO_EXPLORATION_RESULTS.md`, updated after each phase.
- Odoo credentials are stored in environment variables, never hardcoded.

---

## Phase 1: Odoo Database Exploration Script

**Goal:** Discover what we have access to — models, permissions, record counts, field structures.

**Script:** `ml/odoo_explorer.py`

1. Authenticates via XML-RPC using Python's built-in `xmlrpc.client`
2. Enumerates all accessible models via `ir.model`
3. Tests access to each requested model from the Solicitud (14 models) — tries `search_count` and `fields_get`, catches `AccessError` gracefully
4. Records permissions — for each model: can read? can search? record count? available fields?
5. Probes logistics-adjacent models not in the original request:
   - `stock.picking`, `stock.picking.type` (delivery operations)
   - `fleet.vehicle`, `fleet.vehicle.log.fuel` (truck fleet — if module installed)
   - `delivery.carrier` (shipping carriers)
   - `stock.package.type` (container/package dimensions)
   - `product.packaging` (pallet configs)
   - `stock.move.line` (detailed moves with package/lot info)
   - `mrp.production` (manufacturing — if module installed)
   - Any model containing "truck", "fleet", "delivery", "route", "carrier", "loading", "container", "transport"
6. Saves results locally to `_odoo_exploration_raw.json` and summary to `_ODOO_EXPLORATION_RESULTS.md`

---

## Phase 2: Truck/Loading Data Deep Dive

**Goal:** Pull sample records from logistics-relevant models and analyze actual data shape.

**Script:** `ml/odoo_explorer.py --deep-dive`

1. Pull sample records (limit 5-10) with all fields
2. Investigate `stock.picking`: picking types, weight/volume fields, carrier_id, scheduled dates
3. Check for custom fields (`x_` prefix): `x_truck`, `x_furgon`, `x_carga`, `x_ruta`, `x_capacidad`, `x_container`, `x_peso`, `x_volumen`
4. Check `product.packaging` for box/pallet dimensions, weights
5. Check `stock.package.type` for container type definitions
6. Check `fleet.vehicle` for truck data (license plate, model, capacity)

---

## Phase 3: Live Connection Infrastructure (Code Only — No Sync)

**Goal:** Build reusable Odoo client code on Railway. No database writes.

- `ml/odoo_client.py` — Reusable XML-RPC client class
- `ml/api.py` — Add read-only endpoints: `GET /odoo/health`, `POST /odoo/explore`
- No new dependencies needed (`xmlrpc.client` is stdlib)
- Sync engine deferred until Phase 1-2 results are reviewed

---

## Phase 4: Gap Analysis OR Loading Optimization

**Depends on Phase 2 findings.**

### Path A: Data EXISTS → Build Loading Optimization
Design and build after seeing actual data.

### Path B: Data DOES NOT EXIST → Comprehensive Gap Report
Document exactly what data the client must provide:
- Truck/furgon fleet: vehicle ID, type, max weight (kg), max volume (m³), max pallets
- Product logistics: weight per unit, volume per unit, units per pallet, pallet dimensions
- Routes: origin warehouse, destination, distance, estimated time
- Schedules: delivery windows, frequency constraints
- Receiving capacity: unloading bays, time per truck, warehouse hours

---

## Persistence Artifacts

| File | Purpose |
|------|---------|
| `_ODOO_EXPLORATION_PLAN.md` | This plan |
| `_ODOO_EXPLORATION_RESULTS.md` | All findings from all phases |
| `_odoo_exploration_raw.json` | Phase 1 raw JSON output |
| `_odoo_deep_dive_raw.json` | Phase 2 raw JSON output |
