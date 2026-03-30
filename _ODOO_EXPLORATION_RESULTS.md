# Odoo Exploration Results

**Date:** 2026-03-26
**Odoo URL:** https://suplicentro-2801-27990914.dev.odoo.com
**Database:** suplicentro-2801-27990914
**Odoo Version:** 17.0+e (Enterprise)
**User:** integracion@piensom.com (UID: 182)
**Company:** PLASTICENTRO, S.A.

---

## Phase 1: Database Discovery

### Access Level

- **Cannot access `ir.model`** — no Admin/Access Rights group. Cannot enumerate all models or search by keyword.
- **Can read data** from all 15 Solicitud models and most logistics models.
- **Cannot read** `fleet.vehicle` directly (access denied), but truck data leaks through `stock.picking.x_studio_vehculo` field.

### Solicitud Models (15 tested — all accessible)

| Model | Records | Fields |
|-------|---------|--------|
| `product.product` | 1,628 | 258 |
| `product.category` | 38 | 29 |
| `sale.order` | 80,011 | 185 |
| `sale.order.line` | 446,613 | 110 |
| `purchase.order` | 3,047 | 97 |
| `purchase.order.line` | 19,322 | 58 |
| `stock.quant` | 9,431 | 40 |
| `stock.move` | 1,028,003 | 128 |
| `stock.picking` | 222,230 | 178 |
| `res.partner` | 22,086 | 245 |
| `product.supplierinfo` | 1,965 | 28 |
| `stock.warehouse` | 25 | 53 |
| `stock.location` | 208 | 42 |
| `account.move` | 1,352,394 | 277 |
| `account.move.line` | 5,050,095 | 121 |

**Total data points: ~8.1M records across 15 models.**

### Logistics-Adjacent Models

| Model | Accessible | Records |
|-------|-----------|---------|
| `stock.picking.type` | YES | 118 |
| `stock.move.line` | YES | 900,485 |
| `stock.package.type` | NO (access denied) | — |
| `product.packaging` | YES | 9 |
| `delivery.carrier` | NO (access denied) | — |
| `fleet.vehicle` | NO (access denied) | — |
| `fleet.vehicle.model` | NO (access denied) | — |
| `fleet.vehicle.log.fuel` | NO (model doesn't exist) | — |
| `fleet.vehicle.log.services` | NO (access denied) | — |
| `mrp.production` | NO (access denied) | — |
| `mrp.bom` | NO (access denied) | — |
| `stock.route` | YES | 258 |
| `stock.rule` | YES | 530 |
| `stock.lot` | YES | 0 |

**Key insight:** Fleet module IS installed (fleet.vehicle model exists) but we can't read it directly. However, the `x_studio_vehculo` field on stock.picking is a many2one to `fleet.vehicle` and the display name leaks through (e.g., "Camión/Camión/C-551 BPC").

---

## Phase 2: Truck/Loading Data Deep Dive

### stock.picking — The Main Logistics Hub

**196,531 outgoing delivery orders** (total 222,230 pickings including incoming/internal)

#### Custom Fields Found on stock.picking (Odoo Studio)

The client has added **30+ custom fields** to stock.picking via Odoo Studio. These are the logistics-relevant ones:

| Field | Type | Label | Population Rate |
|-------|------|-------|----------------|
| `x_studio_vehculo` | many2one → fleet.vehicle | Vehículo | 4 records (0.0%) |
| `x_studio_camin` | many2one → fleet.vehicle | Camión | 0 records (0.0%) |
| `x_studio_placa` | char | Placa (license plate) | 54 records (0.0%) |
| `x_studio_ruta_departamentales` | selection | Ruta | 1 record (0.0%) |
| `x_studio_zona` | selection | Zona | 83,371 records (42.4%) |
| `x_studio_municipio` | many2one | Municipio | 152,522 records (77.6%) |
| `x_studio_inicio_carga` | datetime | Inicio Carga | 0 records (0.0%) |
| `x_studio_terminacin_carga` | datetime | Terminación Carga | 4 records (0.0%) |
| `x_studio_fecha_y_hora_entrante` | datetime | Fecha y hora Entrante | 0 records (0.0%) |
| `x_studio_fecha_y_hora_salida_dulgon` | datetime | Fecha y hora Salida Fulgón | 0 records (0.0%) |
| `x_studio_bultos` | integer | Bultos | 0 records (0.0%) |
| `x_studio_picker` | many2one | Picker | — |
| `x_studio_picker_oficial` | many2one | Picker Oficial | — |
| `x_studio_auxiliares_de_carga` | many2many | Auxiliares de carga | — |
| `x_studio_verificador` | many2many | Verificador | — |
| `x_studio_vendedor` | many2one | Vendedor | — |
| `x_studio_orden` | integer | Orden | — |
| `x_studio_total` | monetary | QQ total de la orden | — |

#### Standard Logistics Fields

| Field | Type | Population Rate |
|-------|------|----------------|
| `weight` | float | 3 records with weight > 0 (0.0%) |
| `amount_volume` | float | 187,246 records (95.3%) |
| `carrier_id` | many2one | 0 records (0.0%) |
| `shipping_weight` | float | — |

#### Ruta Selection Values

| Value | Label |
|-------|-------|
| Rutas Locales | Rutas Locales |
| Traslado entre tiendas | Traslado entre tiendas |
| Costa Sur | RD - Costa Sur |
| Sur Occidente | RD - Sur Occidente |
| Oriente | RD - Oriente |
| Sur Oriente | RD - Sur Oriente |
| Nor Occidente | RD - Nor Occidente |
| Norte | RD - Norte |
| Peten | RD - Peten |
| Supermercado | Supermercado |

#### Zona Selection Values

22 zones: 0 through 21 (numeric, likely Guatemala City zones + departmental codes)

### Vehicle Data (from stock.picking samples)

Only 4 deliveries have vehicle assigned. All reference `fleet.vehicle` records by display name:
- `Camión/Camión/C-551 BPC`
- `Camión/Camión/C-655 BQW`
- `Camión/Camión/C-695BZT`

These are license plate numbers (Guatemala format: C-XXX XXX). The fleet module has vehicle records but we cannot read them directly.

### product.packaging — Only 9 Records

Basic packaging definitions (Paquete, Caja, Fardo) with no weight/volume/dimension data. Only tracks UOM conversion and barcodes. **No pallet dimensions, no weight per package.**

### stock.route — 258 Records

Inter-warehouse transfer routes (e.g., "T10CN a T6MIX"). These are Odoo supply chain routes (push/pull rules), not delivery routes to customers.

---

## Phase 3: Assessment — What EXISTS vs What's MISSING

### Data That EXISTS and Is Usable

| Data Point | Source | Coverage | Quality |
|-----------|--------|----------|---------|
| **Volume per delivery** | `stock.picking.amount_volume` | 95.3% | Good — in m³ |
| **Destination municipality** | `x_studio_municipio` | 77.6% | Good — linked to geographic entity |
| **Delivery zone** | `x_studio_zona` | 42.4% | Moderate — numeric zone codes |
| **Delivery dates** | `scheduled_date`, `date_done` | ~100% | Good — timestamps |
| **Customer per delivery** | `partner_id` | ~100% | Good |
| **Products per delivery** | via `stock.move` | ~100% | Good |
| **Quantities per delivery** | `demand_quantity`, `done_quantity` | ~100% | Good |
| **Order value** | `x_studio_total` | — | Present but population rate unknown |
| **Salesperson** | `x_studio_vendedor` | — | Present on samples |
| **Warehouse origin** | `picking_type_id` → warehouse | ~100% | Good |
| **Regional routes** | `x_studio_ruta_departamentales` | 0.0% | Defined but not populated |

### Data That Is CRITICALLY MISSING

| Data Point | Needed For | Status |
|-----------|-----------|--------|
| **Truck capacity (weight)** | Loading optimization | `fleet.vehicle` exists but access denied. Weight fields on picking are 0.0% populated. |
| **Truck capacity (volume)** | Loading optimization | Not available. Fleet module inaccessible. |
| **Product weight per unit** | Loading optimization | `product.product` has `weight` field but need to verify population rate. |
| **Product volume per unit** | Loading optimization | `product.product` has `volume` field — `amount_volume` on picking IS populated (95.3%), so product volumes likely exist. |
| **Loading timestamps** | Schedule optimization | `x_studio_inicio_carga` and `x_studio_terminacin_carga` are 0.0% populated. |
| **Departure timestamps** | Schedule optimization | `x_studio_fecha_y_hora_salida_dulgon` is 0.0% populated. |
| **Package counts/Bultos** | Loading planning | `x_studio_bultos` is 0.0% populated. |
| **License plates / Vehicle assignment** | Truck identification | Only 4 out of 196K deliveries (0.0%) have `x_studio_vehculo`. 54 have `x_studio_placa`. |
| **Pallet configurations** | Loading optimization | `product.packaging` has only 9 records with no dimensions. |
| **Delivery route assignment** | Route optimization | `x_studio_ruta_departamentales` has 1 record populated out of 196K. |

---

## Phase 2b: fleet.vehicle Deep Dive (access granted 2026-03-26 10:10)

### Fleet Summary: 29 Vehicles (28 trucks + 1 warehouse placeholder)

**Critical field: `x_studio_cubicaje` (float) = volume capacity in m³**

| Plate | Category | Cubicaje (m³) | Tonelaje | Driver | Trailer Hook |
|-------|----------|---------------|----------|--------|-------------|
| C-038BNM | Peten | 30.64 | — | Jony Figueroa | No |
| C-049CCL | — | 0.0 | — | Pedro Rodriguez | No |
| C-206 BQC | SJVN LOCAL | 25.0 | — | Carlos Portillo | Yes |
| C-246 BQC | SJVN LOCAL | 25.0 | — | Bacner Mayorga | No |
| C-276 BKP | SJVN LOCAL | 21.0 | — | Antoni Hernández | Yes |
| C-335 BRM | Peten | 28.0 | — | Cristian Suriano | Yes |
| C-382 BSN | SJVN LOCAL | 29.0 | — | José Martinez | Yes |
| C-425 BNZ | SJVN LOCAL | 5.0 | — | Sergio Montufar | Yes |
| C-425 BSF | Zacapa | 49.0 | — | (unassigned) | Yes |
| C-426BSF | Zacapa | 42.0 | — | (unassigned) | Yes |
| C-466CBY | Departamental | 0.0 | 10T | Diego Sosa | No |
| C-523 BWR | SJVN DEPARTAMENTAL | 50.0 | — | Diego Sosa | Yes |
| C-524 BWR | SJVN DEPARTAMENTAL | 50.0 | — | Audi Vásquez | Yes |
| C-546 BNH | SJVN DEPARTAMENTAL | 45.0 | — | David Jal | Yes |
| C-551 BPC | SJVN LOCAL | 23.0 | 3.4 T | Sergio Botello | Yes |
| C-552 BPC | SJVN LOCAL | 26.0 | 3.4 | Andy Gonzalez | Yes |
| C-652BHK | Peten | 18.11 | — | (unassigned) | No |
| C-654 BQW | SJVN DEPARTAMENTAL | 50.0 | — | ACCIDENTADO | No |
| C-655 BQW | SJVN DEPARTAMENTAL | 43.0 | — | Guiliam Carrillo | Yes |
| C-684BZT | SJVN DEPARTAMENTAL | 0.0 | — | Dicter González | Yes |
| C-685BZT | SJVN LOCAL | 30.0 | 3.5 | Cruz Uz | No |
| C-686BZT | SJVN LOCAL | 0.0 | — | Jorge Barrientos | No |
| C-695BZT | SJVN DEPARTAMENTAL | 0.0 | 8 | Andres Lopez | No |
| C-763 BRJ | SJVN LOCAL | 6.0 | — | Pedro Rodriguez | Yes |
| C-820 BMB | SJVN LOCAL | 30.0 | — | Byron Fernández | Yes |
| C-852 BNL | SJVN DEPARTAMENTAL | 45.0 | — | Georgin Vargas | Yes |
| C-959 BTW | SJVN DEPARTAMENTAL | 50.0 | — | Byron Hernández | No |
| C-960 BTW | SJVN DEPARTAMENTAL | 50.0 | — | Himner Coronado | Yes |
| (Sin matrícula) | — | 0.0 | — | (warehouse) | No |

### Fleet Analysis

- **22 of 29 vehicles have cubicaje > 0** (75.9% populated)
- **Volume range:** 5 m³ to 50 m³
- **Fleet categories:**
  - SJVN LOCAL (local deliveries): 11 trucks, 5-30 m³
  - SJVN DEPARTAMENTAL (departmental): 9 trucks, 43-50 m³
  - Peten: 3 trucks, 18-31 m³
  - Zacapa: 2 trucks, 42-49 m³
  - Departamental: 1 truck (10T tonelaje, cubicaje missing)
- **Drivers assigned:** 24 of 29 (one marked "ACCIDENTADO" — out of service)
- **Tonelaje (weight capacity):** Only 5 trucks have this field populated
- **Trailer hook:** 19 of 29 trucks have trailer capability

### What This Means

**We have everything we need for a volume-based truck loading optimizer:**

1. **Truck capacity (m³):** `fleet.vehicle.x_studio_cubicaje` — 22/29 trucks
2. **Product volume (m³):** `product.product.volume` — 74.6% of products
3. **Delivery volume (m³):** `stock.picking.amount_volume` — 95.3% of deliveries
4. **Destination:** `stock.picking.x_studio_municipio` + `x_studio_zona` — 77.6%/42.4%
5. **Fleet-to-category mapping:** trucks are already categorized by route type (local vs departamental vs Peten vs Zacapa)

**The client confirmed loading is done by volume (m³), not weight.** This aligns perfectly with the data — cubicaje is populated, tonelaje is not.

---

## Phase 4: Gap Analysis & Recommendations

### Updated Situation (after fleet.vehicle access + client clarification)

**STATUS: PATH A — Data EXISTS. We can build the loading optimizer.**

The client confirmed:
1. **Loading is by volume (m³), not weight** — this is the primary constraint
2. **Current process is Excel + WhatsApp** — fully manual, ripe for automation
3. **Fleet data is now accessible** — 29 vehicles with cubicaje (m³ capacity) populated

We now have all three pillars:
- **DEMAND:** What needs to ship (delivery orders with product volumes) — 95.3% coverage
- **SUPPLY:** What trucks are available (fleet with m³ capacity) — 75.9% have cubicaje
- **DESTINATION:** Where it goes (municipality/zone) — 77.6% coverage

### Product Weight & Volume Population

| Metric | Count | Coverage |
|--------|-------|----------|
| Total products | 1,628 | — |
| Products with volume > 0 | 1,215 | **74.6%** |
| Products with weight > 0 | 1 | **0.1%** (only 1 product) |

**Volume is well-populated** — 74.6% of products have volume data, which explains why 95.3% of deliveries have `amount_volume`. This is the core dimensional data needed for loading optimization.

**Weight is virtually absent** — only 1 product out of 1,628 has weight data. This is a significant gap for truck loading (weight limits are as important as volume limits).

### What the Client Needs to Provide or Start Tracking

To build truck/container loading optimization, we need the following data that does NOT exist in Odoo today:

#### Must Have (Blocking)

1. **Fleet/Vehicle data** — We need read access to `fleet.vehicle` model, OR the client needs to provide:
   - Vehicle ID / License plate
   - Vehicle type (camión, furgón, panel, etc.)
   - Max weight capacity (kg)
   - Max volume capacity (m³)
   - Number of pallet positions (if applicable)
   - Currently active vehicles

2. **Product weight** — Need to verify if `product.product.weight` is populated. If volume is tracked (it is), weight might be too.

3. **Consistent vehicle assignment to deliveries** — Currently 4 out of 196K. Either:
   - Start assigning vehicles in Odoo (use the existing `x_studio_vehculo` field)
   - Provide the assignment rules/patterns manually (e.g., "Zone 1-5 → Truck A, Zone 6-10 → Truck B")

#### Should Have (For Optimization Quality)

4. **Loading time windows** — Start using `x_studio_inicio_carga` and `x_studio_terminacin_carga` fields to build historical loading time data

5. **Route assignments** — Start using `x_studio_ruta_departamentales` to track which regional route each delivery follows

6. **Bultos (package count)** — Start tracking number of packages per delivery in `x_studio_bultos`

#### Nice to Have (For Future Enhancement)

7. **Delivery time windows** — When customers expect delivery (AM/PM, specific hours)
8. **Unloading time estimates** — How long each stop takes
9. **Road distance/time between stops** — Can be calculated via Google Maps API if we have addresses

### Immediate Next Steps

1. **Request `fleet.vehicle` read access** from the IT admin — this is the single most impactful change
2. **Check `product.product.weight` and `product.product.volume` population** — if products have weight/volume, we can calculate truck loads even without full fleet data
3. **Get the fleet list manually** — even a spreadsheet with plate numbers and capacities would unblock us
4. **Start a conversation about operational process** — the custom fields exist, they just need to be filled in as part of daily operations

### What We CAN Build Today (Without Missing Data)

Even with current data gaps, we can build:

1. **Daily delivery volume analysis** — total m³ per day, per zone, per route (using the 95.3% volume coverage)
2. **Geographic delivery clustering** — group deliveries by municipality/zone for route optimization
3. **Delivery demand forecasting** — predict daily outbound volume by zone/municipality
4. **Historical delivery pattern analysis** — peak days, seasonal patterns, zone-level trends

These are valuable deliverables that demonstrate capability while we wait for the fleet/vehicle data.
