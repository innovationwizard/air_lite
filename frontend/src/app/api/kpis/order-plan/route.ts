import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Verified 2026-05-11: rpc_abc_xyz_classification returns avg_daily_demand=0 for ALL rows.
// avg_daily_demand is therefore computed here from revenue_daily (sales metric, last 90 days
// before the inventory snapshot of 2026-03-03).
const SNAPSHOT_DATE = '2026-03-03';
const DEMAND_WINDOW_DAYS = 90;
const DEMAND_FROM = '2025-12-03'; // 90 days before SNAPSHOT_DATE

// WARNING: unconfirmed with client — using furgón 53 pies as demo approximation.
// All furgon calculations are downstream of this constant.
const FURGO_M3 = 122;

// Source: capital-congelado/page.tsx lines 45–54
const SAFETY_STOCK_DAYS: Record<string, number> = {
  AX: 3,  AY: 7,  AZ: 14,
  BX: 5,  BY: 10, BZ: 14,
  CX: 7,  CY: 10, CZ: 14,
};
const DEFAULT_SAFETY_STOCK_DAYS = 7;

interface SupplierOrderSummary {
  supplier_class: string;
  sku_count_total: number;
  sku_count_with_order: number;
  total_gtq: number;
  total_furgones: number;
  // SKUs excluded because lead_time_days = 0 in the DB (misconfigured in Odoo)
  skus_with_zero_lead_time: number;
}

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    // 1. 23 demo SKUs: default_code + supplier_class
    const { data: demoProds, error: dpErr } = await supabase
      .from('products_acid_test_active')
      .select('default_code, supplier_class')
      .eq('is_top_10_in_class', true);
    if (dpErr) throw dpErr;
    if (!demoProds || demoProds.length === 0) {
      return NextResponse.json({ suppliers: [], snapshot_date: SNAPSHOT_DATE, furgo_m3: FURGO_M3, furgo_confirmed: false });
    }

    const demoSkus = demoProds.map((p) => p.default_code);
    const skuToSupplier = new Map(demoProds.map((p) => [p.default_code, p.supplier_class]));

    // 2. products table: id, sku, volume_m3
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id, sku, volume_m3')
      .in('sku', demoSkus);
    if (pErr) throw pErr;
    const skuToProduct = new Map((products ?? []).map((p) => [p.sku, p]));
    const pidToSku = new Map((products ?? []).map((p) => [p.id, p.sku]));
    const productIds = (products ?? []).map((p) => p.id);

    // 3. ABC/XYZ RPC: abc_class, xyz_class, current_stock, lead_time_days, unit_cost
    // NOTE: avg_daily_demand from this RPC is 0 for all rows — do not use it.
    const { data: abcRows, error: abcErr } = await supabase.rpc('rpc_abc_xyz_classification');
    if (abcErr) throw abcErr;
    const abcMap = new Map(
      (abcRows ?? [])
        .filter((r: { sku: string }) => demoSkus.includes(r.sku))
        .map((r: { sku: string }) => [r.sku, r]),
    );

    // 4. avg_daily_demand from revenue_daily (sales metric, 90-day window before snapshot)
    const { data: salesRows, error: sErr } = await supabase
      .from('revenue_daily')
      .select('product_id, quantity')
      .in('product_id', productIds)
      .eq('metric', 'sales')
      .gte('observation_date', DEMAND_FROM)
      .lte('observation_date', SNAPSHOT_DATE);
    if (sErr) throw sErr;

    const salesByPid = new Map<number, number>();
    for (const row of salesRows ?? []) {
      salesByPid.set(row.product_id, (salesByPid.get(row.product_id) ?? 0) + (row.quantity ?? 0));
    }
    const avgDemand = new Map<string, number>();
    for (const [pid, total] of salesByPid.entries()) {
      const sku = pidToSku.get(pid);
      if (sku) avgDemand.set(sku, total / DEMAND_WINDOW_DAYS);
    }

    // 5. Compute order recommendation per SKU, aggregate by supplier_class
    const supplierTotals = new Map<string, SupplierOrderSummary>();
    for (const sku of demoSkus) {
      const supplierClass = skuToSupplier.get(sku) ?? 'UNKNOWN';
      if (!supplierTotals.has(supplierClass)) {
        supplierTotals.set(supplierClass, {
          supplier_class: supplierClass,
          sku_count_total: 0,
          sku_count_with_order: 0,
          total_gtq: 0,
          total_furgones: 0,
          skus_with_zero_lead_time: 0,
        });
      }
      const summary = supplierTotals.get(supplierClass)!;
      summary.sku_count_total += 1;

      const abc = abcMap.get(sku) as Record<string, number | string | null> | undefined;
      const prod = skuToProduct.get(sku);
      const avg = avgDemand.get(sku) ?? 0;
      const currentStock: number = (abc?.current_stock as number) ?? 0;
      const leadTime: number = (abc?.lead_time_days as number) ?? 0;
      const unitCost: number = (abc?.unit_cost as number) ?? 0;
      const abcClass: string = (abc?.abc_class as string) ?? '';
      const xyzClass: string = (abc?.xyz_class as string) ?? '';
      const volumeM3: number = prod?.volume_m3 ?? 0;

      if (leadTime === 0) {
        summary.skus_with_zero_lead_time += 1;
      }

      if (avg === 0 || unitCost === 0) continue;

      const ssDay = SAFETY_STOCK_DAYS[abcClass + xyzClass] ?? DEFAULT_SAFETY_STOCK_DAYS;
      const targetStock = avg * (2 * leadTime + ssDay);
      const qtyRaw = Math.max(0, targetStock - currentStock);
      const qtyRec = Math.ceil(qtyRaw);

      if (qtyRec > 0) {
        summary.sku_count_with_order += 1;
        summary.total_gtq += qtyRec * unitCost;
        if (volumeM3 > 0) {
          summary.total_furgones += (qtyRec * volumeM3) / FURGO_M3;
        }
      }
    }

    return NextResponse.json({
      suppliers: Array.from(supplierTotals.values()).sort((a, b) =>
        a.supplier_class.localeCompare(b.supplier_class),
      ),
      snapshot_date: SNAPSHOT_DATE,
      furgo_m3: FURGO_M3,
      furgo_confirmed: false,
    });
  } catch (error) {
    console.error('order-plan GET error:', error);
    return NextResponse.json(
      { error: 'Error al calcular plan de compras', details: String(error) },
      { status: 500 },
    );
  }
}
