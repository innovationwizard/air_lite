# Truck Loading & Volume Optimization — Bridge Plan
_Authored: 2026-04-27 | Based on: industry research + full codebase gap analysis_

---

## 1. Problem Statement

The system currently produces:
- **Purchase scheduler output:** "Buy 2,000 FARDO20 from Carvajal on Wednesday"
- **Warehouse capacity check:** "That's 25 m³, your 10,007 m³ bodega can absorb it"
- **Forecast page furgon columns:** "This month's Carvajal receipts represent ~18 furgon-equivalents of volume"

The client's actual question is:
> *"¿Cuántos furgones de cada producto deben entrar el lunes? ¿El martes? Si un furgón no llega el lunes como se esperaba, ¿cómo se rebalancea?"*

Answering this requires bridging five disconnected layers: demand forecast → purchase quantity → truck manifest → dock slot → delay rebalancing. None of the connections between these layers exist today.

---

## 2. Industry Research Findings

### 2.1 The Correct Problem Structure

This is **inbound middle-mile logistics optimization**, not last-mile delivery. The distinction matters:

| Dimension | Inbound / Middle-Mile (our problem) | Last-Mile (not our problem) |
|-----------|-------------------------------------|-----------------------------|
| Stops per route | 1–3 (supplier → bodega) | 50–200 customer addresses |
| Key constraint | Trailer cube + weight + dock windows | Stop sequence, traffic, driver familiarity |
| Replanning frequency | Daily batch (15-min solve budget) | Real-time (every 5–30 min) |
| Key algorithm | Bin-packing + dock scheduling | RL + TSP heuristics |
| Data requirement | SKU dimensions, dock capacity, dock hours | Road network, real-time GPS |

Our problem has two coupled subproblems:
1. **Load building:** Given purchase_schedule_lines for week W, pack SKUs into minimum number of trucks without violating volume/weight/stackability constraints.
2. **Dock scheduling:** Given a set of truck manifests with arrival windows, assign each truck to a dock slot without saturating the dock's available hours.

### 2.2 Algorithms — What Works in Production

**For load building (bin-packing):**

The gold standard for production at our scale is a **greedy constructive heuristic with pattern-based placement**, not exact optimization:

- **Deepest-Bottom-Left-Fill (DBLF):** Places items at the deepest, bottommost, leftmost available position. Simple, deterministic, runs in milliseconds. This is Walmart's production approach.
- **Floor-spot pattern:** Predefined loading patterns (width-aligned, length-aligned, pinwheel, hybrid). Products are grouped into "super-blocks" before placement, reducing state space by 10–100×.
- **Column Generation** (for 1D volume-only packing): Reframes bin-packing as a set-cover problem. Each pattern (truck load) is a "column." Finds near-optimal packing via LP relaxation + knapsack pricing subproblem. The best open-source approach for 1D packing at low SKU counts.

**Why not exact MIP (Gurobi/CPLEX)?**  
Gurobi benchmarks show 11.5% gap at 100–200 items and **793% gap at 800–1,000 items** for VRP-type problems on a 1-minute budget. Exact solvers collapse at scale. Gurobi's correct role here is strategic network decisions (lane planning, which supplier ships what), not per-truck packing.

**For dock scheduling:**
- **Constraint Programming** (OR-Tools CP-SAT) is the correct tool. It handles overlapping time window constraints, multi-dock assignment, and cleanup time gaps natively. OptaPlanner is strong here too (its weakness is VRP, not scheduling).
- The dock scheduling problem is a **resource-constrained scheduling problem**, not a routing problem. Different solver family.

**Joint optimization insight (Walmart Edelman Award, 2022):**  
Solving routing first then packing leaves significant value on the table. Walmart's Load Planner solves them **coupled** via tabu search: an outer routing loop proposes route configurations, and an inner packing oracle validates feasibility and scores cube utilization. This is the architectural target for a mature version of our system. For an MVP, decoupled (pack first, then schedule) is acceptable.

### 2.3 Architecture Pattern — Amazon / Walmart Production Design

```
[Demand Forecast]
      ↓ (daily batch)
[PO Quantity Calculation]        ← purchase_scheduler.py (EXISTS)
      ↓
[PO Consolidation by Supplier × Window]   ← (MISSING)
      ↓
[Load Builder — Bin Packing]              ← (MISSING)
      ↓ produces truck manifests
[Dock Appointment System]                 ← (PARTIAL — alerts only)
      ↓ assigns dock × time slot
[ETA Monitoring + Rebalancing]           ← (MISSING)
      ↓ feeds actuals back
[Supplier Reliability Model]             ← (MISSING)
      ↓ adjusts safety buffers
[Demand Forecast]                        ← closes loop
```

Key architectural principle from Amazon: **enforce plan consistency**. Constant re-optimization creates network thrash. The plan creates "rails" within which execution operates. Rebalancing is triggered by deviation thresholds, not every event.

**Rebalancing triggers (production pattern):**
- ETA deviation ≤ 30 min → auto-bump dock slot, no human approval
- ETA deviation 30 min – 2 hrs → re-solve affected dock schedule, requires approval
- ETA deviation > 2 hrs or truck cancellation → re-run full load optimizer for affected supplier + week, flag to buyer

### 2.4 Guatemala-Specific Constraints

These are non-negotiable inputs to the ML system design — they affect algorithm choice, buffer sizing, and data collection strategy:

| Constraint | Impact | System Adaptation Required |
|------------|--------|-----------------------------|
| Guatemala ranks 134/141 countries in road connectivity; only 7,420 km of 17,440 km are paved | Drive time matrices from Google Maps/OSRM are unreliable | Build empirical drive-time table from actual delivery history (Carvajal origin → Central bodega). Required: collect actual departure and arrival timestamps. |
| Average speed on Guatemala–Puerto Quetzal route: 33–37 km/h | Journey times are 2–3× what mapping APIs predict | Hard-code ETA matrices per supplier × destination per season; do not use API-computed ETAs |
| Rainy season (May–October): landslides, bridge closures, recurring Villa Nueva sinkhole on Guatemala–Puerto Quetzal highway | Stochastic seasonal disruption | Add seasonal_disruption_buffer parameter; increase safety stock and ETA variance during May–October |
| Regional truck fleet averages 18 years old; breakdown probability >> developed markets | Higher than expected no-show rate | Model supplier ETA distribution with fat tails; keep 1-day buffer in dock schedule for make-up slots |
| Telematics and real-time GPS adoption: very low | Cannot rely on automated ETA updates | Design for manual check-in events (driver confirms departure, arrival) via app or WhatsApp webhook |
| SAT customs: 75% air cargo released < 24 hrs; sea cargo variable; still requires paper documents | Inbound sea container arrival is stochastic | Model port dwell time as a distribution per container type; 3–5 day buffer for contenedor types |

### 2.5 Open-Source Tools

| Tool | Use Case | Gap | Recommended? |
|------|----------|-----|--------------|
| **Google OR-Tools CP-SAT** | Dock scheduling (resource-constrained scheduling) | None for our scale | **Yes — for dock scheduling** |
| **PyVRP** | VRP with time windows (if ever needed for multi-stop routing) | Does not model 3D loading | Yes — only if multi-depot routing needed |
| **Python-MIP / PuLP** | 1D bin-packing via column generation | Requires custom implementation | Yes — for load building MVP |
| **Gurobi** | Strategic lane planning | Collapses at VRP scale | Only for MIP strategic decisions |
| **OptaPlanner / Timefold** | Dock scheduling, dock assignment | Java-based; poor VRP | No — OR-Tools is better fit for our stack |

---

## 3. Current System Assets (What We Have to Build On)

### 3.1 Data Available Immediately

| Asset | Table / File | Truck Loading Relevance |
|-------|-------------|------------------------|
| SKU dimensions | `products.volume_m3`, `height_m`, `width_m`, `length_m` | **Primary bin-packing input** |
| Purchase recommendations | `purchase_schedule_lines.recommended_qty`, `recommended_date`, `product_id`, `supplier_name` | **Primary demand signal for manifests** |
| Warehouse dock config | `warehouse_config.num_docks`, `working_hours_start/end`, `dock_cleanup_minutes` | **Dock constraint input** |
| Dock saturation | `rpc_oa_reception_saturation()` | **Check before assigning slots** |
| Hot list | `rpc_oa_hot_list()` | **Loading priority for critical SKUs** |
| Net inventory | `rpc_oa_net_inventory()` | **Validate recommended orders won't overshoot** |
| Reception schedule write | `POST /api/oa/reception` | **Output destination for optimizer** |
| Unload time estimates | `unloading_times` (supplier × unit_type) | **Dock time input for scheduling** |

### 3.2 Schema Gaps — What Must Be Added

| Missing Piece | Where | Impact |
|--------------|-------|--------|
| Truck type master (capacity_m3, weight_limit_kg, pallet_capacity) | New table `truck_types` | Cannot run bin-packing without this |
| Product stackability flag + max stack height | `products` table | Without it, optimizer assumes no stacking → wastes 30–40% of truck cube |
| Product packaging (units_per_pallet, pallet_height_m) | New table or `products` columns | Needed for pallet-level packing (not unit-level) |
| Supplier-specific truck type preference | `suppliers` or `product_suppliers` | Which truck type does Carvajal send? Reyma? |
| Lead times confirmed and populated | `product_suppliers.lead_time_days` | Currently sparse; drives all safety stock calculations |
| Supplier cut-off time (latest PO submission for next truck) | `suppliers` table | Determines which week's PO makes which truck |
| Truck manifest table | New table `truck_manifests` + `truck_manifest_lines` | Output destination for bin-packing results |
| Dock conflict detection | Logic in dock scheduler | Currently dock_assigned is manual and unvalidated |
| Arrival event log | New table `truck_events` | Required for ETA model training and supplier reliability tracking |

### 3.3 Odoo Field Population Status

From `odoo_probe_trucks.py`:

| Odoo Field | Population | Action |
|-----------|-----------|--------|
| `x_studio_placa` (license plate) | Sparse / empty | Do not rely on; collect manually in reception_schedule |
| `x_studio_bultos` (package count) | Empty | Calculate from purchase_order_lines instead |
| `amount_volume` | Partially populated | Validate against products.volume_m3; use products table as SSOT |
| `x_studio_inicio_carga / terminacion_carga` | Unknown | Capture via reception_schedule.started_at / completed_at instead |
| `x_studio_vehculo / x_studio_camin` | Sparse | Enrich truck_events table manually at first |

**Decision:** Supabase is SSOT for all truck loading data. Odoo's truck fields are too sparsely populated to depend on. The system must collect ground truth via the app's reception flow.

---

## 4. Implementation Plan

### Phase 0: Data Foundation (Prerequisite — Cannot Skip)
**Goal:** Fill the data gaps that make optimization impossible without guessing.

#### 0-A. Schema additions

**New table: `truck_types`**
```sql
CREATE TABLE truck_types (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(50) UNIQUE NOT NULL,  -- matches unloading_times.unit_type enum
  display_name  VARCHAR(100) NOT NULL,
  internal_length_m   NUMERIC(6,3) NOT NULL,  -- usable cargo L
  internal_width_m    NUMERIC(6,3) NOT NULL,  -- usable cargo W
  internal_height_m   NUMERIC(6,3) NOT NULL,  -- usable cargo H
  max_payload_kg      NUMERIC(10,2) NOT NULL,
  volume_m3           NUMERIC(10,4) GENERATED ALWAYS AS
                        (internal_length_m * internal_width_m * internal_height_m) STORED,
  notes         TEXT
);
```

**Columns to add to `products`:**
```sql
ALTER TABLE products
  ADD COLUMN stackable        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN max_stack_units  INT     NOT NULL DEFAULT 1,      -- max units high
  ADD COLUMN weight_kg        NUMERIC(10,4);                   -- gross weight per stock unit
```

**Columns to add to `suppliers`:**
```sql
ALTER TABLE suppliers
  ADD COLUMN preferred_truck_type  VARCHAR(50) REFERENCES truck_types(code),
  ADD COLUMN cutoff_day_of_week    INT,   -- 0=Mon … 6=Sun
  ADD COLUMN cutoff_time           TIME,  -- latest PO submission for next truck
  ADD COLUMN avg_lead_time_days    NUMERIC(5,1),
  ADD COLUMN lead_time_variance_days NUMERIC(5,1);
```

**New table: `truck_manifests`**
```sql
CREATE TABLE truck_manifests (
  id               SERIAL PRIMARY KEY,
  run_id           INT REFERENCES purchase_schedule_runs(id),
  supplier_id      INT REFERENCES suppliers(id),
  truck_type_code  VARCHAR(50) REFERENCES truck_types(code),
  planned_load_date       DATE NOT NULL,
  planned_arrival_date    DATE NOT NULL,
  planned_arrival_window_start TIME,
  planned_arrival_window_end   TIME,
  dock_assigned    INT,
  total_volume_m3  NUMERIC(10,4),
  total_weight_kg  NUMERIC(12,4),
  utilization_pct  NUMERIC(5,2),         -- (total_volume_m3 / truck_type.volume_m3) × 100
  status           VARCHAR(30) DEFAULT 'planned',
    -- planned | confirmed | in_transit | arrived | unloaded | cancelled | rescheduled
  reception_schedule_id INT REFERENCES reception_schedule(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE truck_manifest_lines (
  id              SERIAL PRIMARY KEY,
  manifest_id     INT REFERENCES truck_manifests(id) ON DELETE CASCADE,
  product_id      INT REFERENCES products(id),
  schedule_line_id INT REFERENCES purchase_schedule_lines(id),
  quantity        NUMERIC(12,4) NOT NULL,
  volume_m3       NUMERIC(10,6) NOT NULL,  -- quantity × products.volume_m3
  weight_kg       NUMERIC(10,4),           -- quantity × products.weight_kg
  load_priority   INT NOT NULL DEFAULT 0,  -- higher = load first (from hot_list)
  position_notes  TEXT                     -- packing position hint (future)
);
```

**New table: `truck_events`** (ground truth for ETA model)
```sql
CREATE TABLE truck_events (
  id             SERIAL PRIMARY KEY,
  manifest_id    INT REFERENCES truck_manifests(id),
  event_type     VARCHAR(50) NOT NULL,
    -- departed_supplier | checkpoint | arrived_bodega | unload_started | unload_completed | delay_reported | cancelled
  event_source   VARCHAR(20) DEFAULT 'manual',  -- manual | odoo | webhook
  occurred_at    TIMESTAMPTZ NOT NULL,
  reported_at    TIMESTAMPTZ DEFAULT now(),
  location_note  TEXT,   -- e.g. "Salida de Carvajal Sanarate", "Villa Nueva checkpoint"
  notes          TEXT
);
```

#### 0-B. Seed truck type master data
The four unit types already in the system must be confirmed and seeded:

| code | display_name | L (m) | W (m) | H (m) | volume_m3 | max_payload_kg |
|------|-------------|-------|-------|-------|-----------|---------------|
| furgon_53 | Furgón 53' | **?** | **?** | **?** | ~122 (unconfirmed) | **?** |
| contenedor_40 | Contenedor 40' | 12.03 | 2.35 | 2.39 | 67.6 | 26,680 |
| contenedor_45 | Contenedor 45' | 13.56 | 2.35 | 2.70 | 86.0 | 27,600 |
| camion_local | Camión Local | **?** | **?** | **?** | **?** | **?** |

**The furgon_53 capacity is currently 122 m³ — a demo approximation that must be confirmed before any production use.**

#### 0-C. Data quality audit
Before writing the optimizer, confirm population rates for:
```sql
-- Run this and report results
SELECT
  COUNT(*)                                      AS total_products,
  COUNT(volume_m3)                              AS has_volume,
  COUNT(height_m)                               AS has_height,
  COUNT(width_m)                                AS has_width,
  COUNT(length_m)                               AS has_length,
  COUNT(weight_kg)                              AS has_weight,
  ROUND(COUNT(volume_m3)::NUMERIC / COUNT(*) * 100, 1) AS volume_pct
FROM products
WHERE is_active = true;
```

Any product with NULL volume_m3 cannot be bin-packed. The optimizer must either:
a) Reject the product from the manifest and flag it, or
b) Use (height_m × width_m × length_m) as a fallback if dimensions exist

#### 0-D. Confirm lead times
```sql
SELECT
  s.name AS supplier,
  COUNT(ps.product_id) AS products,
  COUNT(ps.lead_time_days) AS has_lead_time,
  AVG(ps.lead_time_days) AS avg_lead_time
FROM product_suppliers ps
JOIN suppliers s ON s.id = ps.supplier_id
GROUP BY s.name;
```

---

### Phase 1: Load Builder (Bin-Packing Engine)
**Goal:** Given a completed purchase_schedule_run, produce truck_manifests with truck_manifest_lines.

**Algorithm choice: 1D volume-first greedy with hot-list priority**

For our problem at MVP scale (< 50 SKUs per supplier per week, 1–5 trucks per run), a simple greedy bin-packing with column generation refinement is correct. Full 3D placement (DBLF) is the target for Phase 3.

**MVP algorithm (1D volume packing with priority):**
```
INPUTS:
  lines = purchase_schedule_lines WHERE run_id = X, ordered by:
    1. hot_list products first (from rpc_oa_hot_list)
    2. largest volume_m3 contribution first (descending)
  truck_type = supplier.preferred_truck_type
  truck_capacity_m3 = truck_types.volume_m3
  truck_max_weight_kg = truck_types.max_payload_kg

ALGORITHM:
  manifests = []
  current_manifest = new_manifest()

  FOR each line in lines:
    line_volume = line.recommended_qty × product.volume_m3
    line_weight = line.recommended_qty × product.weight_kg

    IF current_manifest.total_volume + line_volume <= truck_capacity_m3
       AND current_manifest.total_weight + line_weight <= truck_max_weight_kg:
      current_manifest.add_line(line)
    ELSE:
      manifests.append(current_manifest)
      current_manifest = new_manifest()
      current_manifest.add_line(line)

  IF current_manifest.lines is not empty:
    manifests.append(current_manifest)

  RETURN manifests
```

**Planned arrival date:** `recommended_date + supplier.avg_lead_time_days`  
**Arrival window:** `warehouse_config.working_hours_start` to `working_hours_start + 4 hours` (first priority slots for hot-list trucks)

**Output:** One or more `truck_manifest` records + N `truck_manifest_lines` per manifest.

**Location:** `ml/load_builder.py`

**API endpoint:** `POST /api/poc/load-manifest` with body `{run_id: INT}`

---

### Phase 2: Dock Scheduler
**Goal:** Given a set of truck manifests, assign each to a dock slot without violating capacity or creating conflicts.

**Algorithm: Constraint Programming via OR-Tools CP-SAT**

OR-Tools CP-SAT is the correct choice for dock scheduling. It natively handles:
- Time window constraints (truck can only arrive within its window)
- Resource capacity constraints (N docks, each with fixed hours)
- No-overlap constraints (cleanup time between trucks on same dock)
- Priority ordering (hot-list trucks get earlier slots)

**Input:**
- `truck_manifests` with planned_arrival_window_start / end and estimated_unload_hours
- `warehouse_config` num_docks, working_hours_start/end, dock_cleanup_minutes
- `rpc_oa_reception_saturation()` to check existing commitments on each date

**Output:**
- `truck_manifests.dock_assigned` updated
- `truck_manifests.planned_arrival_window_start/end` adjusted to assigned slot
- One `reception_schedule` record per manifest (written via `POST /api/oa/reception`)

**Conflict detection before writing:** Before assigning, the scheduler must check:
```sql
-- Are there already trucks assigned to this dock on this date that overlap?
SELECT COUNT(*) FROM truck_manifests
WHERE dock_assigned = $dock
  AND planned_arrival_date = $date
  AND status NOT IN ('cancelled', 'rescheduled')
  AND (planned_arrival_window_start, planned_arrival_window_start + estimated_unload_hours * INTERVAL '1 hour')
      OVERLAPS ($new_start, $new_end);
```

**Location:** `ml/dock_scheduler.py`

**API endpoint:** `POST /api/poc/dock-schedule` with body `{manifest_ids: INT[]}`

---

### Phase 3: Delay Monitoring & Rebalancing
**Goal:** When a truck deviates from its planned arrival, trigger the appropriate response automatically.

**Event ingestion:** `POST /api/truck-event` accepts:
```json
{
  "manifest_id": INT,
  "event_type": "departed_supplier | checkpoint | delay_reported | arrived_bodega | ...",
  "occurred_at": "ISO timestamp",
  "notes": "Optional context"
}
```

**ETA update logic (Kalman filter, or exponential smoothing for MVP):**
```python
# For MVP: simple weighted average of historical lead time + elapsed time
expected_arrival = departed_at + supplier.avg_lead_time_hours
variance = supplier.lead_time_variance_days * 24  # in hours
# Update with each checkpoint event:
# new_eta = checkpoint_time + estimated_remaining_hours
```

**Rebalancing triggers:**
| Deviation | Action | Human approval? |
|-----------|--------|----------------|
| ≤ 30 min late | Auto-bump dock slot by 30 min if available; otherwise hold | No |
| 30 min – 2 hrs late | Re-run dock_scheduler for affected date; propose new slot | Requires buyer confirmation |
| > 2 hrs late or cancelled | Re-run load_builder for affected supplier/week; flag hot-list products for extraordinary order check | Requires buyer + compras action |

**Impact on Hot List:** When a truck is significantly delayed, call `rpc_oa_hot_list()` and cross-reference with the delayed manifest's lines. Any hot-list product on the delayed truck is escalated in the UI with a banner: "⚠️ Producto en quiebre inminente — furgón retrasado X horas."

**Location:** `ml/eta_monitor.py`

---

### Phase 4: 3D Physical Packing (Full DBLF)
**Goal:** Upgrade load builder from 1D volume packing to 3D placement with stackability constraints.

This phase is warranted only after:
- Product dimensions (height, width, length) are confirmed ≥ 90% populated
- Stackability flags are collected from the client
- Truck internal dimensions are confirmed per truck type
- Phase 1–3 are stable in production

**Algorithm: DBLF (Deepest-Bottom-Left-Fill) + floor-spot patterns**
- Pre-sort items by height (tallest first) into layers
- Fill layers left-to-right, front-to-back
- Validate stackability flag before placing on top of another item
- Validate max stack height and weight

This is Walmart's production approach. It runs in milliseconds for < 200 items and produces packing arrangements that can be rendered as visual loading instructions (future UX feature).

**Target utilization:** 75–85% truck cube. Below 65% → consider consolidating two partial loads. Above 90% → split to avoid compliance risk.

---

### Phase 5: Supplier Reliability Model (Feedback Loop)
**Goal:** Actuals from truck_events feed back into safety buffer calculations in the purchase scheduler.

**Reliability metrics (computed nightly):**
```sql
-- Per supplier: on-time delivery rate
SELECT
  m.supplier_id,
  COUNT(*) AS total_deliveries,
  COUNT(*) FILTER (WHERE
    ABS(EXTRACT(EPOCH FROM (
      actual_arrival.occurred_at - m.planned_arrival_date::TIMESTAMPTZ
    )) / 3600) <= 4
  ) AS on_time_deliveries,
  AVG(
    EXTRACT(EPOCH FROM (
      actual_arrival.occurred_at - m.planned_arrival_date::TIMESTAMPTZ
    )) / 3600
  ) AS avg_delay_hours,
  STDDEV(
    EXTRACT(EPOCH FROM (
      actual_arrival.occurred_at - m.planned_arrival_date::TIMESTAMPTZ
    )) / 3600
  ) AS stddev_delay_hours
FROM truck_manifests m
JOIN truck_events actual_arrival ON actual_arrival.manifest_id = m.id
  AND actual_arrival.event_type = 'arrived_bodega'
WHERE m.status = 'unloaded'
GROUP BY m.supplier_id;
```

**Feedback mechanism:**
- `suppliers.avg_lead_time_days` and `lead_time_variance_days` updated nightly from actuals
- Purchase scheduler's safety stock Z-score adjusted per-supplier based on variance:
  - Low variance (σ < 0.5 days): Z = 1.28 (90% service level)
  - Medium variance (σ 0.5–1.5 days): Z = 1.65 (95% service level)
  - High variance (σ > 1.5 days): Z = 2.05 (98% service level)
- This closes the full loop: actual delivery patterns → tighter or looser safety buffers → fewer unnecessary purchase recommendations

---

## 5. What We Do NOT Know (Clarifying Questions)

These questions must be answered before writing a single line of Phase 0 code. They are not optional — the optimizer cannot run on guessed values.

### Q1 — Truck Internal Dimensions (BLOCKING)
**What are the exact internal usable dimensions (length × width × height in meters) and maximum payload weight (kg) for each truck type the business uses?**

Specifically:
- furgón 53': internal cargo L, W, H, and max payload kg
- camión local: same
- (contenedor_40 and contenedor_45 have published ISO dimensions, but confirm if the supplier's containers match standard)

*Why this is blocking:* The 122 m³ constant in the code is industry-standard but unconfirmed for our specific suppliers. Loading 123 m³ of product into a truck we believe holds 122 m³ is a physical failure.

---

### Q2 — Supplier Truck Types (BLOCKING)
**Which truck type does Carvajal send? Which does Reyma send? Do they always send the same type, or does it vary?**

Does the client place the truck order (and therefore controls truck type), or does the supplier dispatch whatever is available?

---

### Q3 — Stackability Rules (HIGH PRIORITY)
**Which product categories can be stacked? What is the maximum stack height or weight limit per pallet?**

Without this, the optimizer assumes no stacking. A standard 53-foot furgon typically allows 2–3 pallet heights. Ignoring stackability wastes 30–40% of truck cube — the difference between 3 trucks and 2 trucks per shipment.

---

### Q4 — Pallet vs. Floor Load (HIGH PRIORITY)
**Are products delivered palletized (on standard pallets) or floor-loaded (individual cases stacked directly)?**

If palletized:
- What pallet dimensions does the supplier use? (Euro 120×80 cm? North American 48×40 in?)
- How many product units per pallet?
- What is the max stacked height per pallet (in cm or in)?

If floor-loaded: the optimizer works at individual unit level using product dimensions directly.

---

### Q5 — Supplier Cut-Off Times (HIGH PRIORITY)
**What is the latest day and time a PO can be submitted to Carvajal for it to be included in the next scheduled truck? Same question for Reyma.**

Example: "PO must be submitted to Carvajal by Tuesday 3pm for inclusion in that week's Friday dispatch."

This is required to correctly map a purchase_schedule_line's recommended_date to a specific truck departure.

---

### Q6 — Confirmed Lead Times (HIGH PRIORITY)
**What is the actual lead time (in business days) from PO submission to product arrival at the bodega, per supplier?**

Current database values: `product_suppliers.lead_time_days` is sparse. The purchase scheduler uses a hardcoded policy (7-day reorder, 14-day ceiling) that doesn't explicitly model lead time.

Is the lead time consistent per supplier, or does it vary by product or season?

---

### Q7 — Truck Arrival Frequency (CONTEXT REQUIRED)
**How many furgones arrive from Carvajal per week, on average? From Reyma? On which days of the week do they typically arrive?**

This determines whether the dock schedule is a daily or weekly planning problem, and whether dock saturation is a real risk or a theoretical one.

---

### Q8 — Delay Communication Process (CONTEXT REQUIRED)
**When a truck is delayed today, how does the buyer find out? Who calls whom? Is there a WhatsApp group? How much notice is typical?**

The ETA monitoring system must plug into whatever communication channel already exists — it cannot require the supplier to adopt new technology. Understanding the current process determines whether we build a webhook, a WhatsApp bot, a simple web form, or a manual event entry screen.

---

### Q9 — Weight Limit Enforcement (CONTEXT REQUIRED)
**Is axle weight distribution a real operational constraint, or is it ignored in practice?**

Guatemala enforces axle weight limits, but enforcement at regional checkpoints is inconsistent. If the client's trucks have never failed a weight check, weight can be tracked but not enforced as a hard constraint in the MVP. If weight compliance is a real concern, it must be modeled as a hard constraint in the bin-packing algorithm.

---

### Q10 — Volume m³ Data Completeness (MUST VERIFY)
**What percentage of active products in the Supabase products table have volume_m3 populated?**

Run:
```sql
SELECT
  COUNT(*) AS total_active,
  COUNT(volume_m3) AS has_volume,
  ROUND(COUNT(volume_m3)::NUMERIC / COUNT(*) * 100, 1) AS pct
FROM products WHERE is_active = true;
```

Any product missing volume_m3 cannot be packed. If the rate is below 80%, there is a data collection task before Phase 1 can begin.

---

### Q11 — Bodega Dock Constraints (VERIFY)
**The warehouse_config table shows Central bodega has 5 docks, 06:00–00:00, 30-min cleanup time. Are these values correct and confirmed with the client?**

Also: Are all 5 docks identical, or do some have height restrictions, weight capacity limits, or refrigeration requirements that affect which truck types can use which dock?

---

## 6. Phase Sequencing and Dependencies

```
Q1–Q6 answered → Phase 0 schema migrations → Phase 0 data seed
                                                     ↓
                                               Phase 1: Load Builder
                                                     ↓
                                               Phase 2: Dock Scheduler
                                                     ↓
Q7–Q11 answered → Phase 3: Delay Monitoring + Rebalancing
                                                     ↓
                              Product dimensions ≥90% populated
                                                     ↓
                                        Phase 4: 3D DBLF Packing
                                                     ↓
                              ≥6 months of truck_events data
                                                     ↓
                                   Phase 5: Supplier Reliability Model
```

Phases 1 and 2 can be built the moment Q1–Q6 are answered and Phase 0 schema is migrated.  
Phases 3–5 require operational data that accumulates over time.

---

## 7. What the System Will Be Able to Answer (by Phase)

| Question | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 5 |
|----------|---------|---------|---------|---------|---------|
| How many furgones of volume did we receive this month? | ✅ (exists today) | | | | |
| How many furgones does this week's purchase recommend? | | ✅ | | | |
| Which products go in which furgón? | | ✅ | | | |
| Which dock does each furgón use, and at what time? | | | ✅ | | |
| Will the dock be saturated on Monday? | ✅ (alert only) | | ✅ (hard constraint) | | |
| If furgón #1 is 3 hours late, what changes? | | | | ✅ | |
| Which products are at quiebre risk because of that delay? | | | | ✅ | |
| What safety buffer should we hold for Carvajal given their reliability history? | | | | | ✅ |

---

## 8. Key File Map (After Implementation)

| File | Purpose |
|------|---------|
| `ml/load_builder.py` | Bin-packing engine; input: run_id; output: truck_manifests |
| `ml/dock_scheduler.py` | CP-SAT dock assignment; input: manifest_ids; output: dock assignments |
| `ml/eta_monitor.py` | ETA update + rebalancing trigger logic |
| `ml/supplier_reliability.py` | Nightly batch: actuals → lead time + variance update |
| `supabase/migrations/YYYYMMDD_truck_loading_schema.sql` | Phase 0: truck_types, manifest tables, truck_events, product/supplier columns |
| `frontend/src/app/api/truck-event/route.ts` | Event ingestion endpoint |
| `frontend/src/app/api/poc/load-manifest/route.ts` | Trigger load builder |
| `frontend/src/app/api/poc/dock-schedule/route.ts` | Trigger dock scheduler |
| `frontend/src/app/(authenticated)/poc/manifiestos/page.tsx` | Manifest view: trucks, contents, dock slots |
| `frontend/src/app/(authenticated)/oa/recepcion/page.tsx` | Enhanced with manifest links and delay event buttons |

---

## 9. What NOT to Build

Per the project's production-first philosophy, explicitly out of scope for any phase:

- **Real-time GPS tracking:** Telematics adoption in Guatemala is too low; build for manual check-ins
- **Carrier matching / load board:** Not a marketplace; direct supplier relationships only
- **Last-mile delivery optimization:** Out of scope — this is inbound replenishment, not customer delivery
- **Multi-depot routing:** Single Central bodega; expand only if Zacapa or Petén bodegas become active
- **Pure MIP exact optimization:** Collapses at scale; use greedy heuristics + CP-SAT
- **Driver app:** Too early; truck events entered by buyer/warehouse staff in the existing reception UI

---

_Sources: Walmart Load Planner (INFORMS Edelman 2022), Amazon Science transportation optimization blog, PyVRP benchmarks (INFORMS Journal on Computing 2024), Hexaly vs Gurobi vs OR-Tools VRP benchmarks (2024), DHL OptiCarton case study, Guatemala Logistics Infrastructure Assessment (LogCluster 2024), Uber Freight carrier pricing RL system, GOPT 3D bin packing (IEEE RA-L 2024), Kinaxis Maestro architecture, OR-Tools CP-SAT documentation._
