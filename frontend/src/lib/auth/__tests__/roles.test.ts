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
  CAN_VIEW_POC,
  CAN_EDIT_STATUS_PLAN,
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
    // `gerencia` está confinada a /status desde 2026-09-01, así que su
    // aterrizaje POST-confinamiento se consulta pasando un foco vacío.
    expect(getDefaultPage('gerencia', {})).toBe('/gerencia/forecast');
    expect(getDefaultPage('gerencia')).toBe('/status');
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
  /**
   * A4.26 (2026-09-01) — `carvajal-vivo` entra al confinamiento: es el SEGUNDO
   * modelo de Alexis, con las mismas reglas y otros números. Va después de
   * `reyma-vivo` porque el primer elemento es la página de aterrizaje y Reyma
   * sigue siendo el modelo validado.
   */
  it('inventario alcanza sus modelos en vivo Y la carga de facturas', () => {
    const rutas = focusRoutes('inventario');
    expect(rutas).toEqual(['/inventarios/reyma-vivo', '/inventarios/carvajal-vivo',
      '/inventarios/facturas', '/status']);
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
  /**
   * `gerencia` se confinó a /status el 2026-09-01. Es el único rol cuyo foco
   * ES /status: las demás superficies que alcanzaba son demostraciones, no la
   * herramienta diaria, y lo que gerencia pide todos los días todavía no está
   * construido. Sustituye al caso especial `isGerenciaDemo` del Sidebar, que
   * ocultaba enlaces sin restringir rutas.
   */
  it('gerencia queda acotada a /status, que es también su aterrizaje', () => {
    expect(focusRoutes('gerencia')).toEqual(['/status', '/comercial/forecast']);
    expect(getDefaultPage('gerencia')).toBe('/status');
    const rutas = focusRoutes('gerencia')!;
    for (const fuera of ['/backtest', '/gerencia/gap-report', '/gerencia/validacion',
                         '/gerencia/forecast', '/compras', '/oa/excepciones']) {
      expect(isWithinFocus(fuera, rutas)).toBe(false);
    }
  });

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
    expect(focusRoutes('compras'))
      .toEqual(['/compras/reabastecimiento-vivo', '/status', '/comercial/forecast']);
  });

  it('los roles sin entrada NO están confinados', () => {
    for (const rol of ['superuser', 'admin', 'ventas', 'operaciones']) {
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
        const regla = Object.entries(PAGE_PERMISSIONS)
          .filter(([r]) => ruta === r || ruta.startsWith(`${r}/`))
          .sort((a, b) => b[0].length - a[0].length)[0];
        expect(regla).toBeDefined();
        expect(isAuthorized(rol, regla[1])).toBe(true);
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
    expect(getDefaultPage('ventas')).toBe('/comercial/forecast');
    expect(getDefaultPage('nonsense')).toBe('/backtest');
    expect(getDefaultPage('ventas', {})).toBe('/comercial/forecast');
  });
});

/**
 * Auditoría de RBAC del 2026-09-01. Dos agujeros y una asimetría que conviene
 * dejar fijada, porque el proyecto tiene DOS tablas de autorización que
 * funcionan al revés una de la otra.
 */
describe('RBAC — cobertura de PAGE_PERMISSIONS', () => {
  it('/poc está protegido: no lo abre cualquier sesión autenticada', () => {
    // Antes no tenía entrada, así que el middleware admitía cualquier rol y lo
    // único que dejaba fuera a los demás era que el enlace estuviera oculto.
    expect(PAGE_PERMISSIONS['/poc']).toBeDefined();
    expect(PAGE_PERMISSIONS['/poc']).toEqual(CAN_VIEW_POC);
  });

  it('cerrar el agujero de /poc no cambió el acceso que la interfaz ya daba', () => {
    for (const rol of ['admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser']) {
      expect(isAuthorized(rol, CAN_VIEW_POC)).toBe(true);
    }
    // `operaciones` nunca vio esta página en ningún grupo del menú, y
    // `project_manager` está acotado a /status.
    expect(isAuthorized('operaciones', CAN_VIEW_POC)).toBe(false);
    expect(isAuthorized('project_manager', CAN_VIEW_POC)).toBe(false);
    expect(isAuthorized('superuser', CAN_VIEW_POC)).toBe(true);
  });

  it('project_manager sólo alcanza /status, y no escribe el juicio', () => {
    expect(isAuthorized('project_manager', PAGE_PERMISSIONS['/status'])).toBe(true);
    for (const ruta of ['/compras', '/inventarios/reyma-vivo', '/gerencia', '/admin', '/superuser', '/oa']) {
      expect(isAuthorized('project_manager', PAGE_PERMISSIONS[ruta])).toBe(false);
    }
    // Escribe el PLAN; el estado lo juzga el TSV versionado, no la interfaz.
    expect(isAuthorized('project_manager', CAN_EDIT_STATUS_PLAN)).toBe(true);
    for (const rol of ['compras', 'inventario', 'gerencia', 'admin', 'operaciones']) {
      expect(isAuthorized(rol, CAN_EDIT_STATUS_PLAN)).toBe(false);
    }
  });

  it('toda página autenticada cae bajo alguna entrada, salvo las conocidas', () => {
    // Fija la asimetría: sin entrada = abierto a cualquier sesión. Si aparece
    // una página nueva sin permiso, esta prueba lo dice antes que un usuario.
    const cubierta = (p: string) =>
      Object.keys(PAGE_PERMISSIONS).some((k) => p === k || p.startsWith(`${k}/`));
    for (const p of ['/status', '/poc/programacion', '/oa/excepciones', '/compras/forecast',
                     '/inventarios/facturas', '/superuser', '/admin/usuarios', '/gerencia/gap-report']) {
      expect(cubierta(p)).toBe(true);
    }
  });
});

/**
 * PAGE_PERMISSIONS se DECLARABA y no se aplicaba en ninguna parte (auditoría
 * 2026-09-01): las páginas son componentes de cliente sin guarda de servidor,
 * así que lo único que separaba a un rol no confinado de /admin/usuarios o
 * /superuser era que sus llamadas a la API respondieran 403. Estas pruebas
 * fijan la coincidencia POR PREFIJO MÁS ESPECÍFICO que ahora usa el middleware.
 */
describe('PAGE_PERMISSIONS — coincidencia por prefijo más específico', () => {
  const reglaPara = (ruta: string) =>
    Object.entries(PAGE_PERMISSIONS)
      .filter(([r]) => ruta === r || ruta.startsWith(`${r}/`))
      .sort((a, b) => b[0].length - a[0].length)[0];

  it('una sub-ruta hereda el permiso de su padre', () => {
    expect(reglaPara('/comercial/forecast')[0]).toBe('/comercial');
    expect(reglaPara('/oa/plan-maestro')[0]).toBe('/oa');
    expect(reglaPara('/poc/programacion')[0]).toBe('/poc');
  });

  it('gana la regla más específica, no la primera que coincide', () => {
    // '/inventarios/facturas' es más específico que cualquier prefijo corto.
    expect(reglaPara('/inventarios/facturas')[0]).toBe('/inventarios/facturas');
  });

  it('las páginas sensibles quedan fuera del alcance de los roles operativos', () => {
    for (const rol of ['ventas', 'financiero', 'testuser', 'operaciones', 'project_manager']) {
      expect(isAuthorized(rol, reglaPara('/admin/usuarios')[1])).toBe(false);
      expect(isAuthorized(rol, reglaPara('/superuser')[1])).toBe(false);
    }
    expect(isAuthorized('superuser', reglaPara('/superuser')[1])).toBe(true);
    expect(isAuthorized('admin', reglaPara('/admin/usuarios')[1])).toBe(true);
  });

  it('ventas alcanza el forecast comercial y nada del silo de compras', () => {
    expect(isAuthorized('ventas', reglaPara('/comercial/forecast')[1])).toBe(true);
    expect(isAuthorized('ventas', reglaPara('/compras/reabastecimiento-vivo')[1])).toBe(false);
  });

  it('una página sin regla sigue abierta a cualquier sesión — comportamiento previo', () => {
    expect(reglaPara('/una-pagina-nueva-sin-permiso')).toBeUndefined();
  });
});
