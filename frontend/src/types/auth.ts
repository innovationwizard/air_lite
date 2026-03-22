/**
 * Authentication and authorization types
 */

export interface AuthUser {
  user_id: number;
  username: string;
  email: string;
  is_active: boolean;
  roles: string[];
  permissions: string[];
  created_at: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthActions {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  setLoading: (isLoading: boolean) => void;
  checkAuth: () => Promise<boolean>;
}

export type AuthStore = AuthState & AuthActions;

// Permission check helpers
export type PermissionName =
  | 'user:create'
  | 'user:read'
  | 'user:update'
  | 'user:delete'
  | 'role:create'
  | 'role:read'
  | 'role:update'
  | 'permission:read'
  | 'recommendation:read'
  | 'forecast:read'
  | 'insight:read'
  | 'kpi:read'
  | 'dashboard:read'
  | 'product:read'
  | 'inventory:read'
  | 'export:create';

export type RoleName =
  | 'SUPERUSER'
  | 'Admin'
  | 'Compras'
  | 'Ventas'
  | 'Inventario'
  | 'Gerencia'
  | 'Finanzas'; 