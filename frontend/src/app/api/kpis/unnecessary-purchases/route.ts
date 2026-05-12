import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Inventory snapshot and demand window — mirrors order-plan/route.ts
const SNAPSHOT_DATE = '2026-03-03';
const DEMAND_WINDOW_DAYS = 90;
const DEMAND_FROM = '2025-12-03'; // 90 days before SNAPSHOT_DATE

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    // 1. 23 demo SKUs: default_code + supplier_class
    const { data: demoProds, error: dpErr } = await supabase
      .from('products_acid_test_active')
      .select('default_code, supplier_class')
      .eq('is_top_10_in_class', true);
    if (dpErr) throw dpErr;
    if (!demoProds || demoProds.length === 0) return NextResponse.json([]);

    const demoSkus = demoProds.map((p) => p.default_code);
    const skuToSupplier = new Map(demoProds.map((p) => [p.default_code, p.supplier_class]));

    // 2. products table: id, sku
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', demoSkus);
    if (pErr) throw pErr;
    const skuToProductId = new Map((products ?? []).map((p) => [p.sku, p.id]));
    const pidToSku = new Map((products ?? []).map((p) => [p.id, p.sku]));
    const productIds = (products ?? []).map((p) => p.id);

    // 3. ABC/XYZ RPC: current_stock, lead_time_days, unit_cost, product_name, supplier_name
    // NOTE: avg_daily_demand from this RPC is unreliable — computed from revenue_daily instead (gate #5)
    const { data: abcRows, error: abcErr } = await supabase.rpc('rpc_abc_xyz_classification');
    if (abcErr) throw abcErr;
    const abcMap = new Map(
      (abcRows ?? [])
        .filter((r: { sku: string }) => demoSkus.includes(r.sku))
        .map((r: { sku: string }) => [r.sku, r]),
    );

    // 4. Reliable avg_daily_demand from revenue_daily sales metric (90-day window before snapshot)
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

    // 5. Purchases received within the 90-day window before snapshot
    const { data: purchRows, error: purchErr } = await supabase
      .from('revenue_daily')
      .select('product_id, quantity, observation_date')
      .in('product_id', productIds)
      .eq('metric', 'purchases_received')
      .gte('observation_date', DEMAND_FROM)
      .lte('observation_date', SNAPSHOT_DATE);
    if (purchErr) throw purchErr;

    const purchByPid = new Map<number, { total_qty: number; latest_date: string }>();
    for (const row of purchRows ?? []) {
      const existing = purchByPid.get(row.product_id);
      if (!existing) {
        purchByPid.set(row.product_id, {
          total_qty: row.quantity ?? 0,
          latest_date: row.observation_date,
        });
      } else {
        existing.total_qty += row.quantity ?? 0;
        if (row.observation_date > existing.latest_date) {
          existing.latest_date = row.observation_date;
        }
      }
    }

    // 6. Build result: items that had purchases AND are currently over max policy
    const results: Array<{
      sku: string;
      product_name: string;
      supplier_name: string;
      units_received: number;
      gtq_paid: number;
      current_days: number | null;
      max_policy_days: number;
      gtq_inmovilizado: number;
      days_until_policy: number | null;
      received_since: string;
    }> = [];

    for (const sku of demoSkus) {
      const pid = skuToProductId.get(sku);
      if (!pid) continue;

      const purch = purchByPid.get(pid);
      if (!purch || purch.total_qty <= 0) continue;

      const avg = avgDemand.get(sku) ?? 0;
      if (avg <= 0) continue; // no demand signal — cannot evaluate policy compliance

      const abc = abcMap.get(sku) as Record<string, number | string | null> | undefined;
      const currentStock: number = (abc?.current_stock as number) ?? 0;
      const leadTime: number = (abc?.lead_time_days as number) ?? 0;
      const unitCost: number = (abc?.unit_cost as number) ?? 0;
      const productName: string = (abc?.product_name as string) ?? sku;
      const supplierName: string = (abc?.supplier_name as string) ?? skuToSupplier.get(sku) ?? 'N/D';

      // Policy max = lead_time × 3 × avg_daily_demand (matches gtqInmovilizado in capital-congelado)
      const maxTarget = leadTime > 0 ? leadTime * 3 * avg : 0;
      if (currentStock <= maxTarget) continue; // within or below policy — purchase was justified

      const gtqInmovilizado = (currentStock - maxTarget) * unitCost;
      const currentDays = Math.round(currentStock / avg);
      const maxPolicyDays = leadTime * 3;
      const gtqPaid = purch.total_qty * unitCost;
      // Days until stock naturally falls to max policy at current demand rate
      const daysUntilPolicy = Math.ceil((currentStock - maxTarget) / avg);

      results.push({
        sku,
        product_name: productName,
        supplier_name: supplierName,
        units_received: Math.round(purch.total_qty),
        gtq_paid: gtqPaid,
        current_days: currentDays,
        max_policy_days: maxPolicyDays,
        gtq_inmovilizado: gtqInmovilizado,
        days_until_policy: daysUntilPolicy,
        received_since: purch.latest_date,
      });
    }

    // Sort by gtq_paid DESC — most costly over-purchase first
    results.sort((a, b) => b.gtq_paid - a.gtq_paid);

    return NextResponse.json(results);
  } catch (error) {
    console.error('unnecessary-purchases GET error:', error);
    return NextResponse.json(
      { error: 'Error al calcular compras innecesarias', details: String(error) },
      { status: 500 },
    );
  }
}
