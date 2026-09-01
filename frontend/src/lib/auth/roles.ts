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
  /**
   * The client's project manager. Owns the PLAN on /status — priority order,
   * target dates, notes — and nothing else. Deliberately NOT given the compras
   * or inventarios silos: he had been entering with a `compras` credential, so
   * authorising the plan by that role would have handed the same authority to
   * the buyer the plan measures. See 20260901000002_add_project_manager_role.sql
   */
  PROJECT_MANAGER: 'project_manager',
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
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser', 'operaciones', 'project_manager',
];

/**
 * Who may write `status_plan` — the PLAN half of /status (priority order,
 * target dates, notes).
 *
 * The split this enforces: the STATE of each item ("is it done?") is judged by
 * whoever built it, through a versioned TSV and `scripts/sync_status.py`, and
 * there is no route that lets this role touch it. The PLAN ("by when?") is the
 * client PM's. Neither can overwrite the other.
 */
export const CAN_EDIT_STATUS_PLAN: Role[] = ['superuser', 'project_manager'];

/** Quién LEE el forecast comercial consolidado. */
export const CAN_VIEW_FORECAST_COMERCIAL: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'operaciones',
];

/**
 * Quién CAPTURA forecast comercial.
 *
 * `ventas` sólo puede escribir su propio canal, y eso NO se decide acá: el
 * handler lo contrasta contra `user_profiles.area`. Un rol dice qué clase de
 * cosa puede hacer alguien; cuál de sus filas puede tocar es un dato de la
 * fila, no del rol.
 */
export const CAN_CAPTURE_FORECAST: Role[] = ['superuser', 'admin', 'ventas'];

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
 * Roles that can open the Prueba de Concepto page.
 *
 * This list used to live as a private `const` inside `Sidebar.tsx`, which meant
 * an authorization decision was defined in a UI component and enforced nowhere:
 * `/poc/programacion` had no `PAGE_PERMISSIONS` entry, so the middleware let in
 * ANY authenticated session — hiding the link was the only thing keeping other
 * roles out. Audited 2026-09-01.
 *
 * The membership below reproduces EXACTLY the access the UI already granted
 * (the union of the Compras section and the Prueba de Concepto section), so
 * closing the hole neither widens nor narrows anyone's reach. `operaciones` is
 * absent because no sidebar group ever showed it this page, despite a stale
 * comment that said otherwise; `project_manager` is absent because it is scoped
 * to /status alone.
 */
export const CAN_VIEW_POC: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser',
];

/**
 * TEMPORARY delivery-phase focus (Jorge, 2026-08-11): while Wilmer (compras)
 * and Alexis (inventario) onboard, they are CONFINED to their live Odoo pages —
 * the sidebar shows only those items, login lands on the FIRST one, and the
 * middleware redirects every other page (except /update-password) back to it,
 * so nothing distracts from validation. API routes / PAGE_PERMISSIONS are
 * unchanged. Delete entries here to lift the confinement everywhere at once.
 *
 * A LIST, not a single route (2026-08-25): the confinement is per-role, but a
 * role's job can span more than one page. Alexis needs `reyma-vivo` (his live
 * model) AND `facturas` (loading his own invoices, A12) — with a single route
 * the second page was unreachable for exactly the person it was built for,
 * while remaining perfectly visible to superuser. **The first entry is the
 * landing page**; every entry is reachable.
 */
export const ROLLOUT_FOCUS: Partial<Record<Role, string[]>> = {
  // `/status` is APPENDED, never prepended: the first entry is the landing
  // page, and confined users must still land on the page they work in.
  compras: ['/compras/reabastecimiento-vivo', '/status', '/comercial/forecast'],
  inventario: ['/inventarios/reyma-vivo', '/inventarios/carvajal-vivo',
               '/inventarios/facturas', '/status'],
  /**
   * `gerencia` (2026-09-01) — confined to `/status`, and that is not a
   * demotion: it is the first page this role has ever had a recurring reason
   * to open.
   *
   * Everything else it could reach — /backtest, /gerencia/validacion,
   * /gerencia/gap-report, /gerencia/forecast — is a DEMONSTRATION surface.
   * They prove the figures reconcile with Odoo, which is the test that
   * unblocked the project in April; that is something you show once, not
   * something anyone opens on a Tuesday. Leaving them in a real executive's
   * navigation invites the reading that they are the daily tool, and they are
   * not. What management actually asks for every day — the patio report and
   * the view across all physical warehouses — is not built yet (see A6).
   *
   * This entry replaces the `isGerenciaDemo` special case that used to live in
   * Sidebar.tsx: an authorization decision hidden in a UI component, which hid
   * links without restricting routes. ROLLOUT_FOCUS does both, and the
   * middleware honours it. Delete this line to give the surfaces back.
   */
  // `/comercial/forecast` sí entra: no es una demostración, es la vista donde
  // se decide el ajuste de compra del mes.
  gerencia: ['/status', '/comercial/forecast'],
};

/** Routes a role is confined to, or `undefined` when it is not confined. */
export function focusRoutes(
  role: Role | string | null | undefined,
  focus: Partial<Record<Role, string[]>> = ROLLOUT_FOCUS,
): string[] | undefined {
  const routes = role ? focus[role as Role] : undefined;
  return routes && routes.length > 0 ? routes : undefined;
}

/**
 * Is `pathname` inside the confinement? Prefix match, so a page's own
 * sub-routes travel with it. Callers must have established that the role IS
 * confined — an unconfined role reaches everything.
 */
export function isWithinFocus(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

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
  '/inventarios/carvajal-vivo': CAN_VIEW_INVENTARIOS,
  '/inventarios/facturas': CAN_VIEW_INVENTARIOS,
  '/operaciones': CAN_VIEW_OPERACIONES,
  '/gerencia': CAN_VIEW_GERENCIA,
  '/superuser': CAN_VIEW_SYSTEM,
  '/admin': CAN_VIEW_ADMIN,
  '/configuracion': CAN_VIEW_ADMIN,
  // The gap analysis is readable by everyone, including the confined roles.
  '/status': CAN_VIEW_OPERATIONAL,
  // Audited 2026-09-01: this had no entry, so the middleware admitted any
  // authenticated session and only the hidden sidebar link kept roles out.
  '/poc': CAN_VIEW_POC,
  '/comercial': CAN_VIEW_FORECAST_COMERCIAL,
};

/**
 * NOTE on `/configuracion`: that entry points at a page which does not exist
 * (the directory is empty). It is kept ON PURPOSE, and the reason is the
 * opposite of the one governing `route_permissions`. This map RESTRICTS — a
 * page with no entry is open to every authenticated session — so an entry
 * without a page grants nothing today and protects that path in advance if it
 * is ever created. A GRANT pointing at a missing route is the dangerous
 * direction, and those were revoked in 20260901000003_rbac_limpieza.sql.
 */

/**
 * Get the default landing page for a role.
 *
 * `focus` is injectable so the post-rollout behaviour stays reachable and
 * testable while ROLLOUT_FOCUS is populated: pass `{}` to get the landing page
 * a role WILL have once the temporary confinement is lifted.
 */
export function getDefaultPage(
  role: Role | string,
  focus: Partial<Record<Role, string[]>> = ROLLOUT_FOCUS,
): string {
  const focused = focusRoutes(role, focus);
  if (focused) return focused[0];
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
    case ROLES.PROJECT_MANAGER:
      return '/status';
    case ROLES.VENTAS:
      return '/comercial/forecast';
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
  project_manager: 'Gerente de Proyecto',
};
