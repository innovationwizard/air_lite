/**
 * RBAC role definitions and authorization helpers.
 *
 * 8 roles: superuser, admin, gerencia, compras, ventas, inventario, financiero, testuser
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

/** All roles can view backtest results and fear pages */
export const CAN_VIEW_OPERATIONAL: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser',
];

/** Roles that can only see backtest + POC (no fear pages, no admin) */
export const CAN_VIEW_POC_ONLY: Role[] = ['testuser'];

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
  '/superuser': CAN_VIEW_SYSTEM,
  '/admin': CAN_VIEW_ADMIN,
  '/configuracion': CAN_VIEW_ADMIN,
};

/**
 * Get the default landing page for a role.
 */
export function getDefaultPage(role: Role | string): string {
  switch (role) {
    case ROLES.SUPERUSER:
      return '/superuser';
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
};
