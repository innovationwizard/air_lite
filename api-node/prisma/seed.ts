import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─── Seed data ────────────────────────────────────────────────────────────────

const ROLES = [
  'SUPERUSER',
  'Admin',
  'Compras',
  'Ventas',
  'Inventario',
  'Finance',
  'Ejecutivo',
] as const;

const PERMISSIONS = [
  // Users & RBAC
  { name: 'user:read',       description: 'View users and user profiles' },
  { name: 'user:write',      description: 'Create and update users' },
  { name: 'user:delete',     description: 'Deactivate and delete users' },
  { name: 'role:read',       description: 'View roles' },
  { name: 'role:write',      description: 'Create and update roles' },
  { name: 'permission:read', description: 'View permissions' },
  // ML outputs
  { name: 'recommendation:read', description: 'View purchase recommendations' },
  { name: 'forecast:read',       description: 'View demand forecasts' },
  { name: 'insight:read',        description: 'View AI insights' },
  // Finance & KPIs
  { name: 'kpi:read',        description: 'View financial KPIs' },
  { name: 'kpi:write',       description: 'Update KPI definitions' },
  // Dashboards
  { name: 'dashboard:read',  description: 'Access role-specific dashboard' },
  // Inventory
  { name: 'inventory:read',  description: 'View inventory and stock levels' },
  { name: 'inventory:write', description: 'Adjust inventory quantities' },
  // Purchases
  { name: 'purchase:read',   description: 'View purchase orders' },
  { name: 'purchase:write',  description: 'Create and update purchase orders' },
  // Sales
  { name: 'sale:read',       description: 'View sales data' },
  // Admin
  { name: 'admin:all',       description: 'Full administrative access' },
] as const;

// Which permissions each role gets
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPERUSER: PERMISSIONS.map((p) => p.name),
  Admin: [
    'user:read', 'role:read', 'permission:read',
    'recommendation:read', 'forecast:read', 'insight:read',
    'kpi:read', 'dashboard:read', 'inventory:read',
    'purchase:read', 'sale:read', 'admin:all',
  ],
  Compras: [
    'recommendation:read', 'forecast:read', 'insight:read',
    'purchase:read', 'purchase:write', 'inventory:read',
    'dashboard:read',
  ],
  Ventas: [
    'recommendation:read', 'forecast:read', 'insight:read',
    'sale:read', 'inventory:read', 'dashboard:read',
  ],
  Inventario: [
    'inventory:read', 'inventory:write',
    'purchase:read', 'dashboard:read',
  ],
  Finance: [
    'kpi:read', 'kpi:write', 'sale:read',
    'purchase:read', 'dashboard:read',
  ],
  Ejecutivo: [
    'recommendation:read', 'forecast:read', 'insight:read',
    'kpi:read', 'sale:read', 'dashboard:read',
  ],
};

// ─── Seed function ────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // Upsert roles
  const roleMap = new Map<string, number>();
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { roleName },
      update: {},
      create: { roleName },
    });
    roleMap.set(roleName, role.id);
    console.log(`  Role: ${roleName} (id=${role.id})`);
  }

  // Upsert permissions
  const permMap = new Map<string, number>();
  for (const { name, description } of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { permissionName: name },
      update: { description },
      create: { permissionName: name, description },
    });
    permMap.set(name, perm.id);
    console.log(`  Permission: ${name} (id=${perm.id})`);
  }

  // Assign permissions to roles
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleMap.get(roleName);
    if (!roleId) continue;
    for (const permName of permNames) {
      const permissionId = permMap.get(permName);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
    console.log(`  Assigned ${permNames.length} permissions to ${roleName}`);
  }

  // Default admin user — CHANGE PASSWORD AFTER FIRST LOGIN
  const TEMP_PASSWORD = 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@airefill.app',
      passwordHash,
      isActive: true,
    },
  });

  // Assign SUPERUSER role to admin
  const superuserRoleId = roleMap.get('SUPERUSER')!;
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: superuserRoleId } },
    update: {},
    create: { userId: adminUser.id, roleId: superuserRoleId },
  });

  console.log(`\n  Admin user: username=admin, password=${TEMP_PASSWORD}`);
  console.log('  ⚠ Change the admin password immediately after first login.\n');
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
