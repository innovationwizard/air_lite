/**
 * RBAC role-matrix tests — the security regression net for the WorkOS + Aurora
 * RLS migration (D-AUTHZ). These pin down exactly which role may reach which
 * page, so the app-layer authorization behavior is provably preserved when auth
 * moves off Supabase. Includes the cross-privilege negative tests.
 */
import {
  isAuthorized,
  getDefaultPage,
  focusRoutes,
  isWithinFocus,
  PAGE_PERMISSIONS,
  ROLLOUT_FOCUS,
  CAN_VIEW_COMPRAS,
  CAN_VIEW_GERENCIA,
  CAN_VIEW_INVENTARIOS,
  CAN_MANAGE_USERS,
  CAN_MODIFY_SETTINGS,
} from '@/lib/auth/roles';

const NON_SUPERUSER = [
  'admin', 'gerencia', 'compras', 'ventas',
  'inventario', 'financiero', 'testuser', 'operaciones',
];

describe('isAuthorized', () => {
  it('superuser is authorized for anything, even an empty allow-list', () => {
    expect(isAuthorized('superuser', [])).toBe(true);
    expect(isAuthorized('superuser', ['admin'])).toBe(true);
  });

  it('missing/empty role is never authorized', () => {
    expect(isAuthorized(null, ['admin'])).toBe(false);
    expect(isAuthorized(undefined, ['admin'])).toBe(false);
    expect(isAuthorized('', ['admin'])).toBe(false);
  });

  it('allows a role present in the list and denies one absent', () => {
    expect(isAuthorized('compras', CAN_VIEW_COMPRAS)).toBe(true);
    expect(isAuthorized('ventas', CAN_VIEW_COMPRAS)).toBe(false);
  });
});

describe('role-matrix invariants (guard against accidental privilege widening)', () => {
  it('CAN_VIEW_GERENCIA is exactly superuser/admin/gerencia', () => {
    expect([...CAN_VIEW_GERENCIA].sort()).toEqual(['admin', 'gerencia', 'superuser']);
  });

  it('CAN_MANAGE_USERS is exactly superuser/admin', () => {
    expect([...CAN_MANAGE_USERS].sort()).toEqual(['admin', 'superuser']);
  });

  it('CAN_MODIFY_SETTINGS is superuser-only', () => {
    expect([...CAN_MODIFY_SETTINGS]).toEqual(['superuser']);
  });

  it('every page permission set admits superuser', () => {
    for (const roles of Object.values(PAGE_PERMISSIONS)) {
      expect(isAuthorized('superuser', roles)).toBe(true);
    }
  });
});

describe('cross-privilege negative tests (least privilege)', () => {
  it('inventario reaches its silo but not compras/gerencia/admin', () => {
    expect(isAuthorized('inventario', PAGE_PERMISSIONS['/inventarios/reyma'])).toBe(true);
    expect(isAuthorized('inventario', PAGE_PERMISSIONS['/compras'])).toBe(false);
    expect(isAuthorized('inventario', PAGE_PERMISSIONS['/gerencia'])).toBe(false);
    expect(isAuthorized('inventario', PAGE_PERMISSIONS['/admin'])).toBe(false);
    expect(isAuthorized('ventas', PAGE_PERMISSIONS['/inventarios/reyma'])).toBe(false);
    expect(isAuthorized('compras', PAGE_PERMISSIONS['/inventarios/reyma'])).toBe(false);
  });

  it('compras cannot reach gerencia, admin, or superuser pages', () => {
    expect(isAuthorized('compras', PAGE_PERMISSIONS['/gerencia'])).toBe(false);
    expect(isAuthorized('compras', PAGE_PERMISSIONS['/admin'])).toBe(false);
    expect(isAuthorized('compras', PAGE_PERMISSIONS['/superuser'])).toBe(false);
  });

  it('only superuser can view the superuser dashboard', () => {
    for (const role of NON_SUPERUSER) {
      expect(isAuthorized(role, PAGE_PERMISSIONS['/superuser'])).toBe(false);
    }
    expect(isAuthorized('superuser', PAGE_PERMISSIONS['/superuser'])).toBe(true);
  });

  it('only superuser/admin can view admin pages', () => {
    expect(isAuthorized('admin', PAGE_PERMISSIONS['/admin'])).toBe(true);
    expect(isAuthorized('gerencia', PAGE_PERMISSIONS['/admin'])).toBe(false);
    expect(isAuthorized('operaciones', PAGE_PERMISSIONS['/admin'])).toBe(false);
  });
});

describe('getDefaultPage', () => {
  it('routes known roles to their landing pages', () => {
    expect(getDefaultPage('superuser')).toBe('/superuser');
    expect(getDefaultPage('operaciones')).toBe('/operaciones');
    expect(getDefaultPage('gerencia')).toBe('/gerencia/forecast');
    expect(getDefaultPage('admin')).toBe('/backtest');
  });

  it('rollout focus (TEMPORARY, 2026-08-11): compras/inventario land on the FIRST focus route', () => {
    expect(getDefaultPage('compras')).toBe('/compras/reabastecimiento-vivo');
    expect(getDefaultPage('inventario')).toBe('/inventarios/reyma-vivo');
  });

  it('a multi-route focus still lands on the first entry, not the last', () => {
    // Regresión de la elección de diseño: la lista es "a qué puede llegar",
    // el aterrizaje sigue siendo UNO. Si esto se invierte, Alexis entra a
    // cargar facturas en vez de a su modelo.
    expect(getDefaultPage('inventario', { inventario: ['/a', '/b', '/c'] })).toBe('/a');
  });

  it('an empty focus list is treated as NOT confined', () => {
    // Vaciar la lista es como borrar la entrada — el camino post-rollout.
    expect(focusRoutes('inventario', { inventario: [] })).toBeUndefined();
    expect(getDefaultPage('inventario', { inventario: [] })).toBe('/inventarios/reyma');
  });

  it('without the focus map, roles revert to their silo landing page', () => {
    // Este es el comportamiento que vuelve cuando se vacíe ROLLOUT_FOCUS: se
    // prueba inyectando {} para que el camino post-rollout no quede sin cubrir
    // (ni sin verificar) mientras dure el confinamiento temporal.
    expect(getDefaultPage('compras', {})).toBe('/compras');
    expect(getDefaultPage('inventario', {})).toBe('/inventarios/reyma');
    expect(getDefaultPage('superuser', {})).toBe('/superuser');
  });
});

/**
 * A12 (2026-08-25) — el confinamiento de despliegue es POR ROL pero abarca
 * VARIAS páginas. Con una sola ruta por rol, `/inventarios/facturas` quedaba
 * inalcanzable justamente para la persona para quien se construyó (Alexis,
 * rol `inventario`) y perfectamente visible para superuser — un bug que sólo
 * se ve probando con su rol. Estas pruebas son la red.
 */
describe('ROLLOUT_FOCUS — confinamiento de varias rutas', () => {
  it('inventario alcanza su modelo en vivo Y la carga de facturas', () => {
    const rutas = focusRoutes('inventario');
    expect(rutas).toEqual(['/inventarios/reyma-vivo', '/inventarios/facturas', '/status']);
    expect(isWithinFocus('/inventarios/reyma-vivo', rutas!)).toBe(true);
    expect(isWithinFocus('/inventarios/facturas', rutas!)).toBe(true);
  });

  /**
   * 2026-09-01 — `/status` (el gap analysis) se AÑADE a cada confinamiento en
   * lugar de quedar fuera: es el reporte de estado del proyecto y quienes lo
   * usan tienen derecho a leerlo. Va SIEMPRE al final, nunca al principio,
   * porque el primer elemento es la página de aterrizaje y un usuario confinado
   * tiene que seguir cayendo en la pantalla donde trabaja.
   */
  it('/status es alcanzable por los roles confinados, sin ser su aterrizaje', () => {
    for (const rol of ['compras', 'inventario']) {
      const rutas = focusRoutes(rol)!;
      expect(isWithinFocus('/status', rutas)).toBe(true);
      expect(rutas).toContain('/status');
      expect(rutas[0]).not.toBe('/status');
      expect(getDefaultPage(rol)).toBe(rutas[0]);
    }
  });

  it('y NADA más — el confinamiento sigue cerrado', () => {
    const rutas = focusRoutes('inventario')!;
    for (const fuera of [
      '/inventarios/reyma',        // el prefijo de reyma-vivo: NO debe pasar
      '/backtest',
      '/statusquo',                // hermano por prefijo de /status: NO pasa
      '/compras/reabastecimiento-vivo',
      '/gerencia/forecast',
      '/admin',
      '/superuser',
      '/',
    ]) {
      expect(isWithinFocus(fuera, rutas)).toBe(false);
    }
  });

  it('las sub-rutas de una página confinada viajan con ella', () => {
    const rutas = focusRoutes('inventario')!;
    expect(isWithinFocus('/inventarios/facturas/historial', rutas)).toBe(true);
    // Pero un hermano con el mismo prefijo de texto NO es una sub-ruta.
    expect(isWithinFocus('/inventarios/facturas-de-otro', rutas)).toBe(false);
  });

  it('compras sigue confinado a su página de trabajo, más el estado', () => {
    expect(focusRoutes('compras')).toEqual(['/compras/reabastecimiento-vivo', '/status']);
  });

  it('los roles sin entrada NO están confinados', () => {
    for (const rol of ['superuser', 'admin', 'gerencia', 'ventas', 'operaciones']) {
      expect(focusRoutes(rol)).toBeUndefined();
    }
    expect(focusRoutes(null)).toBeUndefined();
    expect(focusRoutes(undefined)).toBeUndefined();
  });

  it('toda ruta confinada tiene permiso de página declarado', () => {
    // El confinamiento restringe; NO otorga. Si una ruta entra a ROLLOUT_FOCUS
    // sin fila en PAGE_PERMISSIONS, el rol la ve en el sidebar y choca contra
    // el gate — o peor, queda sin gate.
    for (const [rol, rutas] of Object.entries(ROLLOUT_FOCUS)) {
      for (const ruta of rutas ?? []) {
        expect(PAGE_PERMISSIONS[ruta]).toBeDefined();
        expect(isAuthorized(rol, PAGE_PERMISSIONS[ruta])).toBe(true);
      }
    }
  });

  it('la página de carga de facturas es del silo de inventarios', () => {
    expect(PAGE_PERMISSIONS['/inventarios/facturas']).toBe(CAN_VIEW_INVENTARIOS);
    expect(isAuthorized('inventario', PAGE_PERMISSIONS['/inventarios/facturas'])).toBe(true);
    expect(isAuthorized('gerencia', PAGE_PERMISSIONS['/inventarios/facturas'])).toBe(true);
    expect(isAuthorized('admin', PAGE_PERMISSIONS['/inventarios/facturas'])).toBe(true);
    expect(isAuthorized('superuser', PAGE_PERMISSIONS['/inventarios/facturas'])).toBe(true);
    for (const rol of ['compras', 'ventas', 'financiero', 'testuser', 'operaciones']) {
      expect(isAuthorized(rol, PAGE_PERMISSIONS['/inventarios/facturas'])).toBe(false);
    }
  });

  it('falls back to /backtest for roles without a specific landing page', () => {
    expect(getDefaultPage('ventas')).toBe('/backtest');
    expect(getDefaultPage('nonsense')).toBe('/backtest');
    expect(getDefaultPage('ventas', {})).toBe('/backtest');
  });
});
