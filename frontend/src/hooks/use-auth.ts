/**
 * useAuth Hook
 * Provides easy access to authentication state and actions
 */
'use client';

import { useAuthStore, useHasPermission, useHasRole } from '@/stores/auth-store';
import type { PermissionName } from '@/types/auth';

export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const checkAuth = useAuthStore((state) => state.checkAuth);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refreshToken,
    checkAuth,
  };
}

export { useHasPermission, useHasRole };

/**
 * Hook to check multiple permissions
 */
export function usePermissions(permissions: PermissionName[]) {
  return useAuthStore((state) => ({
    hasAll: permissions.every(perm => 
      state.user?.permissions.includes(perm) ?? false
    ),
    hasAny: permissions.some(perm => 
      state.user?.permissions.includes(perm) ?? false
    ),
    missing: permissions.filter(perm => 
      !state.user?.permissions.includes(perm)
    ),
  }));
}

/**
 * Hook to get user's permissions as a Set for efficient lookups
 */
export function useUserPermissions(): Set<string> {
  return useAuthStore((state) => 
    new Set(state.user?.permissions ?? [])
  );
}

/**
 * Hook to get user's roles as a Set
 */
export function useUserRoles(): Set<string> {
  return useAuthStore((state) => 
    new Set(state.user?.roles ?? [])
  );
}

/**
 * Hook to check if user is admin (has any admin permission)
 */
export function useIsAdmin(): boolean {
  return useAuthStore((state) => 
    state.user?.permissions.some(perm => 
      perm.startsWith('user:') || perm.startsWith('role:')
    ) ?? false
  );
}

