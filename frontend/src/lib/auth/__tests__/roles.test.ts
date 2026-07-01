/**
 * RBAC role-matrix tests — the security regression net for the WorkOS + Aurora
 * RLS migration (D-AUTHZ). These pin down exactly which role may reach which
 * page, so the app-layer authorization behavior is provably preserved when auth
 * moves off Supabase. Includes the cross-privilege negative tests.
 */
import {
  isAuthorized,
  getDefaultPage,
  PAGE_PERMISSIONS,
  CAN_VIEW_COMPRAS,
  CAN_VIEW_GERENCIA,
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
    expect(getDefaultPage('compras')).toBe('/compras');
    expect(getDefaultPage('operaciones')).toBe('/operaciones');
    expect(getDefaultPage('gerencia')).toBe('/gerencia/forecast');
    expect(getDefaultPage('admin')).toBe('/backtest');
  });

  it('falls back to /backtest for roles without a specific landing page', () => {
    expect(getDefaultPage('ventas')).toBe('/backtest');
    expect(getDefaultPage('nonsense')).toBe('/backtest');
  });
});
