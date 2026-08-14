/**
 * RBAC role definitions and authorization helpers.
 *
 * 9 roles: superuser, admin, gerencia, compras, ventas, inventario, financiero, testuser, operaciones
 * Superuser bypasses all checks.
 */

export const ROLES = {
  SUPERUSER: 'superuser',
  ADMIN: 'admin',
  GERENCIA: 'gerencia',
  COMPRAS: 'compras',
  VENTAS: 'ventas',
  INVENTARIO: 'inventario',
  FINANCIERO: 'financiero',
  TESTUSER: 'testuser',
  OPERACIONES: 'operaciones',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Roles that can run backtests (not just view results) */
export const CAN_RUN_BACKTEST: Role[] = ['superuser', 'admin', 'gerencia'];

/** Roles that can manage users */
export const CAN_MANAGE_USERS: Role[] = ['superuser', 'admin'];

/** Roles that can modify app settings */
export const CAN_MODIFY_SETTINGS: Role[] = ['superuser'];

/** Roles that can view the superuser dashboard */
export const CAN_VIEW_SYSTEM: Role[] = ['superuser'];

/** Roles that can view admin pages (user management, etc.) */
export const CAN_VIEW_ADMIN: Role[] = ['superuser', 'admin'];

export const CAN_VIEW_OPERATIONAL: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser', 'operaciones',
];

/** Roles that can access OA (Open Orders) module */
export const CAN_VIEW_OA: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'inventario', 'financiero', 'operaciones',
];

/** Roles that can access the Operaciones silo (Mario's tool) */
export const CAN_VIEW_OPERACIONES: Role[] = [
  'superuser', 'admin', 'gerencia', 'operaciones',
];

/** Roles that can access the Compras silo (Wilmer's tool) */
export const CAN_VIEW_COMPRAS: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras',
];

/** Roles that can access the Inventarios silo (Alexis' tool) */
export const CAN_VIEW_INVENTARIOS: Role[] = [
  'superuser', 'admin', 'gerencia', 'inventario',
];

/** Roles that can access the Gerencia silo (Luis-facing validation) */
export const CAN_VIEW_GERENCIA: Role[] = [
  'superuser', 'admin', 'gerencia',
];

export const CAN_VIEW_POC_ONLY: Role[] = ['testuser'];

/**
 * TEMPORARY delivery-phase focus (Jorge, 2026-08-11): while Wilmer (compras)
 * and Alexis (inventario) onboard, they are CONFINED to their live Odoo page —
 * the sidebar shows only that item, login lands there, and the middleware
 * redirects every other page (except /update-password) back to it, so nothing
 * distracts from validation. API routes / PAGE_PERMISSIONS are unchanged.
 * Delete entries here to lift the confinement everywhere at once.
 */
export const ROLLOUT_FOCUS: Partial<Record<Role, string>> = {
  compras: '/compras/reabastecimiento-vivo',
  inventario: '/inventarios/reyma-vivo',
};

/**
 * Check if a role is authorized for an action.
 * Superuser always returns true.
 */
export function isAuthorized(userRole: Role | string | null | undefined, allowedRoles: Role[]): boolean {
  if (!userRole) return false;
  if (userRole === ROLES.SUPERUSER) return true;
  return allowedRoles.includes(userRole as Role);
}

/**
 * Page paths mapped to which roles can access them.
 * Used by middleware for server-side route protection.
 */
export const PAGE_PERMISSIONS: Record<string, Role[]> = {
  '/backtest': CAN_VIEW_OPERATIONAL,
  '/preocupaciones': CAN_VIEW_OPERATIONAL,
  '/oa': CAN_VIEW_OA,
  '/compras': CAN_VIEW_COMPRAS,
  '/compras/reabastecimiento': CAN_VIEW_COMPRAS,
  '/compras/reabastecimiento-vivo': CAN_VIEW_COMPRAS,
  '/inventarios/reyma': CAN_VIEW_INVENTARIOS,
  '/inventarios/reyma-vivo': CAN_VIEW_INVENTARIOS,
  '/operaciones': CAN_VIEW_OPERACIONES,
  '/gerencia': CAN_VIEW_GERENCIA,
  '/superuser': CAN_VIEW_SYSTEM,
  '/admin': CAN_VIEW_ADMIN,
  '/configuracion': CAN_VIEW_ADMIN,
};

/**
 * Get the default landing page for a role.
 *
 * `focus` is injectable so the post-rollout behaviour stays reachable and
 * testable while ROLLOUT_FOCUS is populated: pass `{}` to get the landing page
 * a role WILL have once the temporary confinement is lifted.
 */
export function getDefaultPage(
  role: Role | string,
  focus: Partial<Record<Role, string>> = ROLLOUT_FOCUS,
): string {
  const focused = focus[role as Role];
  if (focused) return focused;
  switch (role) {
    case ROLES.SUPERUSER:
      return '/superuser';
    case ROLES.COMPRAS:
      return '/compras';
    case ROLES.OPERACIONES:
      return '/operaciones';
    case ROLES.INVENTARIO:
      return '/inventarios/reyma';
    case ROLES.GERENCIA:
      return '/gerencia/forecast';
    case ROLES.ADMIN:
      return '/backtest';
    default:
      return '/backtest';
  }
}

/**
 * Role display names in Spanish.
 */
export const ROLE_LABELS: Record<Role, string> = {
  superuser: 'Superusuario',
  admin: 'Administrador',
  gerencia: 'Gerencia',
  compras: 'Compras',
  ventas: 'Ventas',
  inventario: 'Inventario',
  financiero: 'Financiero',
  testuser: 'Usuario de Prueba',
  operaciones: 'Operaciones',
};
