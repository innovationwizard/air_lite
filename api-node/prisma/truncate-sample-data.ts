/**
 * Truncates all business/sample data tables from production Aurora DB.
 * Preserves RBAC tables: users, roles, user_roles, permissions,
 * role_permissions, dashboards, dashboard_permissions.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx prisma/truncate-sample-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Tables to truncate — order doesn't matter with CASCADE
const TABLES_TO_TRUNCATE = [
  'odoo_sale_orders',
  'sales_partitioned',
  'returns',
  'purchases',
  'inventory_snapshots',
  'inventory_movements',
  'cycle_counts',
  'forecasts',
  'recommendations',
  'insights',
  'kpis',
  'forecast_scenarios',
  'customer_segments',
  'pdf_jobs',
  'audit_logs',
  'products',
  'clients',
  'suppliers',
  'warehouse_locations',
] as const;

// Tables preserved (listed for reference only)
const TABLES_PRESERVED = [
  'users',
  'roles',
  'user_roles',
  'permissions',
  'role_permissions',
  'dashboards',
  'dashboard_permissions',
  'api_keys',
] as const;

async function main() {
  console.log('=== AIRefill — Truncate Sample Data ===\n');
  console.log('Target DB:', process.env.DATABASE_URL?.replace(/:([^@]+)@/, ':****@'));
  console.log('\nTables to TRUNCATE:');
  TABLES_TO_TRUNCATE.forEach((t) => console.log(`  - ${t}`));
  console.log('\nTables PRESERVED:');
  TABLES_PRESERVED.forEach((t) => console.log(`  + ${t}`));

  // Pre-flight: count rows per table
  console.log('\n--- Row counts before truncation ---');
  for (const table of TABLES_TO_TRUNCATE) {
    const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM "${table}"`
    );
    console.log(`  ${table}: ${result[0].count} rows`);
  }

  // Single transaction: truncate all tables with CASCADE
  console.log('\nTruncating…');
  const tableList = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`
  );

  // Post-flight: verify
  console.log('\n--- Verification (should all be 0) ---');
  for (const table of TABLES_TO_TRUNCATE) {
    const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM "${table}"`
    );
    console.log(`  ${table}: ${result[0].count} rows`);
  }

  // Confirm RBAC is intact
  console.log('\n--- RBAC integrity check ---');
  for (const table of TABLES_PRESERVED) {
    const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM "${table}"`
    );
    console.log(`  ${table}: ${result[0].count} rows`);
  }

  console.log('\nDone. Database is ready for real Odoo data.');
}

main()
  .catch((e) => {
    console.error('TRUNCATION FAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
