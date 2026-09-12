/**
 * RBAC role definitions and authorization helpers.
 *
 * 11 roles: superuser, admin, gerencia, compras, ventas, compras_internacionales, financiero, testuser, operaciones, ceo, sales_manager
 * Superuser bypasses all checks.
 */

export const ROLES = {
  SUPERUSER: 'superuser',
  ADMIN: 'admin',
  GERENCIA: 'gerencia',
  COMPRAS: 'compras',
  VENTAS: 'ventas',
  COMPRAS_INTERNACIONALES: 'compras_internacionales',
  FINANCIERO: 'financiero',
  TESTUSER: 'testuser',
  OPERACIONES: 'operaciones',
  /**
   * The client's project manager. Owns the PLAN on /status — priority order,
   * target dates, notes — and nothing else. Deliberately NOT given the compras
   * or compras_internacionales silos: he had been entering with a `compras`
   * credential, so authorising the plan by that role would have handed the
   * same authority to the buyer the plan measures. See
   * 20260901000002_add_project_manager_role.sql
   */
  PROJECT_MANAGER: 'project_manager',
  /**
   * Luis Roberto Cerezo (CEO). Created 2026-09-03 as an explicit CLONE of
   * `gerencia` — same permission arrays, same ROLLOUT_FOCUS confinement — so
   * he has his own account instead of the shared `gerencia@airefill.app`
   * login. Jorge's own words: "clones of gerencia to begin with, we fine tune
   * later" — expect this to diverge from `gerencia` once that tuning happens.
   */
  CEO: 'ceo',
  /**
   * Raquel López (comercial). Same clone-of-`gerencia` origin and caveat as
   * CEO above. Named `sales_manager` (snake_case) to match `project_manager`,
   * the existing multi-word role — the user asked for this over the literal
   * "salesmanager" they typed.
   */
  SALES_MANAGER: 'sales_manager',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Roles that can run backtests (not just view results) */
export const CAN_RUN_BACKTEST: Role[] = ['superuser', 'admin', 'gerencia', 'ceo', 'sales_manager'];

/** Roles that can manage users */
export const CAN_MANAGE_USERS: Role[] = ['superuser', 'admin'];

/**
 * Roles that can create/edit supplier groups (reabastecimiento-vivo filter).
 * Wilmer-only by design (2026-09-03) — narrower than CAN_VIEW_COMPRAS on
 * purpose, see PROVEEDORES_GROUPING_UX_DESIGN.md §4.
 */
export const CAN_MANAGE_SUPPLIER_GROUPS: Role[] = ['superuser', 'compras'];

/** Roles that can modify app settings */
export const CAN_MODIFY_SETTINGS: Role[] = ['superuser'];

/** Roles that can view the superuser dashboard */
export const CAN_VIEW_SYSTEM: Role[] = ['superuser'];

/** Roles that can view admin pages (user management, etc.) */
export const CAN_VIEW_ADMIN: Role[] = ['superuser', 'admin'];

/**
 * `ventas` was removed 2026-09-11 (Jorge): the channel heads' accounts
 * (tiendas@, etc.) may open the Forecast Comercial and NOTHING else — the
 * tiendas login was seeing the whole Riesgos Empresariales group. See
 * ROLLOUT_FOCUS.ventas for the other half of that fix.
 */
export const CAN_VIEW_OPERATIONAL: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'compras_internacionales', 'financiero', 'testuser', 'operaciones', 'project_manager',
  'ceo', 'sales_manager',
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

/**
 * Who may VIEW /status (the gap analysis). Reserved for the PM, gerencia, and
 * superuser (Jorge, 2026-09-03) — every operational silo (compras,
 * compras_internacionales, ventas, etc.) had been reading it too via
 * CAN_VIEW_OPERATIONAL, which was
 * never a deliberate grant to those roles specifically. `ceo` and
 * `sales_manager`, though clones of `gerencia`, are excluded on purpose: see
 * their ROLLOUT_FOCUS entries below.
 */
export const CAN_VIEW_STATUS: Role[] = ['superuser', 'gerencia', 'project_manager'];

/** Quién LEE el forecast comercial consolidado. */
export const CAN_VIEW_FORECAST_COMERCIAL: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ventas', 'operaciones', 'ceo', 'sales_manager',
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

/**
 * Quién DESBLOQUEA un forecast comercial bloqueado («Bloquear cambios»,
 * 2026-09-11). El jefe de canal bloquea; sólo gerencia de ventas o admin
 * abren — si el que bloqueó pudiera abrir, el registro no probaría nada.
 *
 * Ésta es la ÚNICA lista donde `sales_manager` y `ceo` difieren, y es a
 * propósito (Jorge, 2026-09-11, al igualar los dos roles: "keep the unlock").
 * Sin admin en producción, quitarla dejaría al superusuario como el único que
 * puede abrir un forecast.
 */
export const CAN_DESBLOQUEAR_FORECAST: Role[] = ['superuser', 'admin', 'sales_manager'];

/** Roles that can access OA (Open Orders) module */
export const CAN_VIEW_OA: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'compras_internacionales', 'financiero', 'operaciones', 'ceo', 'sales_manager',
];

/** Roles that can access the Operaciones silo (Mario's tool) */
export const CAN_VIEW_OPERACIONES: Role[] = [
  'superuser', 'admin', 'gerencia', 'operaciones', 'ceo', 'sales_manager',
];

/** Roles that can access the Compras silo (Wilmer's tool) */
export const CAN_VIEW_COMPRAS: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'ceo', 'sales_manager',
];

/** Roles that can access the Compras Internacionales silo (Alexis' tool) */
export const CAN_VIEW_COMPRAS_INTERNACIONALES: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras_internacionales', 'ceo', 'sales_manager',
];

/**
 * Quién ESCRIBE en el silo de Compras (tránsito manual, sugerido de bodega,
 * cobertura, snapshots). Es CAN_VIEW_COMPRAS menos los roles de sólo lectura:
 * Luis Roberto (`ceo`, 2026-09-11, Jorge: "Compras read only and Compras
 * internacionales read only. His dedicated page has not been built yet") y
 * Raquel (`sales_manager`, mismo día: "the exact same access and permissions
 * as role ceo") miran la herramienta de Wilmer pero no la operan — un número
 * que ellos digiten en la tabla de Wilmer aparecería como captura de Wilmer,
 * y el historial dejaría de probar nada.
 *
 * La otra mitad de la lectura es la migración 20260911000008: les quita todo
 * método que no sea GET en /api/compras/* y /api/compras-internacionales/*,
 * así que el middleware corta antes de que el handler mire esta lista.
 */
export const CAN_EDIT_COMPRAS: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras',
];

/** Quién ESCRIBE en Compras Internacionales (precio, proyección, plan, pedido, NC, ETA, facturas). Misma regla que CAN_EDIT_COMPRAS. */
export const CAN_EDIT_COMPRAS_INTERNACIONALES: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras_internacionales',
];

/** Roles that can access the Gerencia silo (Luis-facing validation) */
export const CAN_VIEW_GERENCIA: Role[] = [
  'superuser', 'admin', 'gerencia', 'ceo', 'sales_manager',
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
 * to /status alone. `ventas` was dropped 2026-09-11 — the channel heads get
 * the Forecast Comercial and nothing else (see CAN_VIEW_OPERATIONAL).
 */
export const CAN_VIEW_POC: Role[] = [
  'superuser', 'admin', 'gerencia', 'compras', 'compras_internacionales', 'financiero', 'testuser',
  'ceo', 'sales_manager',
];

/**
 * TEMPORARY delivery-phase focus (Jorge, 2026-08-11): while Wilmer (compras)
 * and Alexis (compras_internacionales) onboard, they are CONFINED to their live Odoo pages —
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
/** Las páginas que ven `ceo` y `sales_manager` — una sola lista para los dos (ver su entrada abajo). */
const FOCO_DIRECCION: string[] = [
  '/comercial/forecast',
  '/compras/reabastecimiento-vivo', '/compras/reabastecimiento-vivo/historial',
  '/compras-internacionales/reyma-vivo', '/compras-internacionales/carvajal-vivo',
  '/compras-internacionales/darnel-vivo', '/compras-internacionales/asia-vivo',
];

export const ROLLOUT_FOCUS: Partial<Record<Role, string[]>> = {
  compras: [
    '/compras/reabastecimiento-vivo', '/compras/reabastecimiento-vivo/historial',
    '/compras/reabastecimiento-vivo/proveedores', '/comercial/forecast',
  ],
  // A6.20 — los CUATRO modelos de Alexis, cada uno con su juego de reglas.
  // `reyma-vivo` sigue primero: es la landing y el modelo validado.
  compras_internacionales: [
    '/compras-internacionales/reyma-vivo', '/compras-internacionales/carvajal-vivo',
    '/compras-internacionales/darnel-vivo', '/compras-internacionales/asia-vivo',
    '/compras-internacionales/facturas',
  ],
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
  // `ceo` (Luis Roberto) y `sales_manager` (Raquel) — creados 2026-09-03 como
  // clones de `gerencia` para el arranque del forecast comercial. Excluidos de
  // `/status` a propósito ese mismo día (Jorge: reservado a pm/gerencia/
  // superuser) pese a ser clones de `gerencia` — así que `/comercial/forecast`,
  // no `/status`, es su aterrizaje. Ajustar cuando se afinen estos roles
  // (palabras de Jorge: "clones... fine tune later").
  //
  // `ceo` afinado 2026-09-11 (Jorge): "Compras read only and Compras
  // internacionales read only. His dedicated page has not been built yet."
  // Ve las páginas EN VIVO de Wilmer y de Alexis — las mismas que ellos tienen
  // en su propio confinamiento — y sigue aterrizando en el forecast comercial
  // mientras no exista la suya. Fuera a propósito: `proveedores` (gestión de
  // grupos, Wilmer-only por CAN_MANAGE_SUPPLIER_GROUPS) y `facturas` +
  // `facturas/pendientes` (son la herramienta de CARGA de Alexis, no una
  // vista). Lo de «read only» no vive acá sino en CAN_EDIT_COMPRAS /
  // CAN_EDIT_COMPRAS_INTERNACIONALES y en la migración 20260911000008.
  //
  // `sales_manager` = `ceo`, mismo día (Jorge: "the exact same access and
  // permissions as role ceo"). Es la MISMA lista, no una copia: si una se
  // mueve, la otra se mueve con ella. La única diferencia entre los dos roles
  // que sobrevivió a propósito es CAN_DESBLOQUEAR_FORECAST (Raquel abre un
  // forecast bloqueado; Luis Roberto no) — ver ese comentario.
  ceo: FOCO_DIRECCION,
  sales_manager: FOCO_DIRECCION,
  /**
   * `ventas` (2026-09-11, Jorge: "tiendas user should be able to access
   * forecast comercial ONLY"). These are the channel-head logins (tiendas@,
   * etc.) that capture their own channel's forecast. Without this entry the
   * role fell through to the legacy Riesgos Empresariales group and /poc.
   * The permission arrays were narrowed too (CAN_VIEW_OPERATIONAL,
   * CAN_VIEW_POC), so lifting this confinement later does NOT reopen them.
   */
  ventas: ['/comercial/forecast'],
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
  // Narrower than the parent page (CAN_VIEW_COMPRAS) — most-specific-prefix-wins
  // in the middleware, so this correctly excludes ventas/compras_internacionales/
  // financiero/etc., who could view reabastecimiento-vivo but were never meant
  // to manage supplier groups.
  '/compras/reabastecimiento-vivo/proveedores': CAN_MANAGE_SUPPLIER_GROUPS,
  '/compras-internacionales/reyma': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/compras-internacionales/reyma-vivo': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/compras-internacionales/carvajal-vivo': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/compras-internacionales/darnel-vivo': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/compras-internacionales/asia-vivo': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/compras-internacionales/facturas': CAN_VIEW_COMPRAS_INTERNACIONALES,
  '/operaciones': CAN_VIEW_OPERACIONES,
  '/gerencia': CAN_VIEW_GERENCIA,
  '/superuser': CAN_VIEW_SYSTEM,
  '/admin': CAN_VIEW_ADMIN,
  '/configuracion': CAN_VIEW_ADMIN,
  // Restricted 2026-09-03 (Jorge): pm, gerencia, superuser only — see
  // CAN_VIEW_STATUS.
  '/status': CAN_VIEW_STATUS,
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
    case ROLES.COMPRAS_INTERNACIONALES:
      return '/compras-internacionales/reyma';
    case ROLES.GERENCIA:
    case ROLES.CEO:
    case ROLES.SALES_MANAGER:
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
  compras_internacionales: 'Compras Internacionales',
  financiero: 'Financiero',
  testuser: 'Usuario de Prueba',
  operaciones: 'Operaciones',
  project_manager: 'Gerente de Proyecto',
  ceo: 'CEO',
  sales_manager: 'Gerente de Ventas',
};
