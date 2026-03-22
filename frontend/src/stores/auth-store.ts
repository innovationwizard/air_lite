/**
 * Zustand store for authentication state management
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AuthStore, AuthUser } from '@/types/auth';
import { authService } from '@/services/auth';
import apiClient from '@/services/api-client';

export const useAuthStore = create<AuthStore>()(
  devtools(
    (set, _get) => ({
      // State
      user: null,
      isAuthenticated: false,
      isLoading: false,

      // Actions
      login: async (username: string, password: string) => {
        set({ isLoading: true });
        
        try {
          const response = await authService.login(username, password);
          const loginUser = response.data.user;
          
          // Transform login response user to AuthUser format
          const user: AuthUser = {
            user_id: loginUser.userId,
            username: loginUser.username,
            email: loginUser.email,
            roles: loginUser.roles,
            permissions: loginUser.permissions,
            is_active: true, // Default to true if not provided
            created_at: new Date().toISOString(), // Default to current date if not provided
          };
          
          // Save user to localStorage
          localStorage.setItem('airefill_user', JSON.stringify(user));
          
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        
        try {
          await authService.logout();
        } catch (error) {
          // Log error but still clear local state
          console.error('Logout error:', error);
        } finally {
          // Clear from localStorage
          localStorage.removeItem('airefill_user');
          localStorage.removeItem('airefill_token');
          
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      refreshToken: async () => {
        try {
          // Refresh handled by API client interceptor
          // Token is refreshed in httpOnly cookie
          // No need to update store
        } catch (error) {
          // If refresh fails, user needs to re-login
          set({
            user: null,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      setUser: (user: AuthUser | null) => {
        set({
          user,
          isAuthenticated: user !== null,
        });
      },

      setLoading: (isLoading: boolean) => {
        set({ isLoading });
      },

      checkAuth: async () => {
        set({ isLoading: true });
        
        try {
          // Check if we have a token in sessionStorage (new way)
          let hasToken = !!apiClient.getToken();
          
          // If no token in sessionStorage, try to get from localStorage (legacy)
          if (!hasToken) {
            const legacyToken = localStorage.getItem("airefill_token");
            if (legacyToken) {
              // Migrate to sessionStorage
              apiClient.setToken(legacyToken);
              hasToken = true;
            }
          }
          
          // Try to refresh token to get a fresh access token
          // This will work if refresh_token cookie is still valid
          try {
            const refreshResponse = await authService.refreshToken();
            // Store the new access token
            if (refreshResponse?.data?.accessToken) {
              apiClient.setToken(refreshResponse.data.accessToken);
            }
          } catch (refreshError) {
            // Refresh failed, but if we have cookies, they might still work
            // Try to verify with existing token/cookies
            const isValid = await authService.verifyToken();
            if (!isValid && !hasToken) {
              // No valid session and no token
              localStorage.removeItem('airefill_user');
              localStorage.removeItem('airefill_token');
              apiClient.clearToken();
              set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
              });
              return false;
            }
          }
          
          // Check for user in localStorage
          const userStr = localStorage.getItem("airefill_user");
          
          if (userStr) {
            // Restore user from localStorage
            const parsedUser = JSON.parse(userStr) as Record<string, unknown>;
            
            // Transform to AuthUser format (handle both new format with user_id and legacy format with userId)
            const user: AuthUser = {
              user_id: (typeof parsedUser.user_id === 'number' ? parsedUser.user_id : undefined) ?? 
                       (typeof parsedUser.userId === 'number' ? parsedUser.userId : undefined) ?? 0,
              username: typeof parsedUser.username === 'string' ? parsedUser.username : '',
              email: typeof parsedUser.email === 'string' ? parsedUser.email : '',
              roles: (Array.isArray(parsedUser.roles) ? parsedUser.roles : []) as string[],
              permissions: (Array.isArray(parsedUser.permissions) ? parsedUser.permissions : []) as string[],
              is_active: typeof parsedUser.is_active === 'boolean' ? parsedUser.is_active : true,
              created_at: typeof parsedUser.created_at === 'string' ? parsedUser.created_at : new Date().toISOString(),
            };
            
            set({
              user,
              isAuthenticated: true,
              isLoading: false,
            });
            return true;
          }
          
          // No user in localStorage, session might be expired
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          return false;
        } catch (error) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          return false;
        }
      },
    }),
    {
      name: 'auth-store',
    }
  )
);

// Selector hooks for better performance
export const useAuth = () => useAuthStore((state) => ({
  user: state.user,
  isAuthenticated: state.isAuthenticated,
  isLoading: state.isLoading,
}));

export const useAuthActions = () => useAuthStore((state) => ({
  login: state.login,
  logout: state.logout,
  refreshToken: state.refreshToken,
  checkAuth: state.checkAuth,
}));

// Helper to check if user has a specific permission
export const useHasPermission = (permission: string): boolean => {
  return useAuthStore((state) => 
    state.user?.permissions.includes(permission) ?? false
  );
};

// Helper to check if user has any of the specified permissions
export const useHasAnyPermission = (permissions: string[]): boolean => {
  return useAuthStore((state) => 
    permissions.some(perm => state.user?.permissions.includes(perm)) ?? false
  );
};

// Helper to check if user has all specified permissions
export const useHasAllPermissions = (permissions: string[]): boolean => {
  return useAuthStore((state) => 
    permissions.every(perm => state.user?.permissions.includes(perm)) ?? false
  );
};

// Helper to check if user has a specific role
export const useHasRole = (role: string): boolean => {
  return useAuthStore((state) => 
    state.user?.roles.includes(role) ?? false
  );
};