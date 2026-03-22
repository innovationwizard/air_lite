import apiClient from './api-client';

export interface LoginResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: {
      userId: number;
      username: string;
      email: string;
      roles: string[];
      permissions: string[];
    };
  };
}

export interface RefreshResponse {
  success: boolean;
  data: {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
  };
}

class AuthService {
  async login(username: string, password: string): Promise<LoginResponse> {
    try {
      const response = await apiClient.request('POST', '/api/v1/auth/login', { username, password });
      
      // Store token from response for Authorization header fallback
      if (response?.data?.accessToken) {
        apiClient.setToken(response.data.accessToken);
      } else if (response?.accessToken) {
        // Handle different response structures
        apiClient.setToken(response.accessToken);
      }
      
      return response;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Login failed';
      throw new Error(message);
    }
  }

  async logout(): Promise<void> {
    try {
      await apiClient.request('POST', '/api/v1/auth/logout');
      // Clear stored token
      apiClient.clearToken();
    } catch (error) {
      console.error('Logout error:', error);
      // Clear token even if logout request fails
      apiClient.clearToken();
    }
  }

  async refreshToken(): Promise<RefreshResponse> {
    try {
      const response = await apiClient.request('POST', '/api/v1/auth/refresh') as RefreshResponse;
      
      // Store the new access token
      if (response?.data?.accessToken) {
        apiClient.setToken(response.data.accessToken);
      }
      
      return response;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Token refresh failed';
      throw new Error(message);
    }
  }

  async verifyToken(): Promise<boolean> {
    try {
      await apiClient.request('GET', '/api/v1/auth/verify');
      return true;
    } catch (error) {
      return false;
    }
  }

  isAuthenticated(): boolean {
    // With cookie-based auth, we can't check locally
    // Return true and let middleware handle it
    return true;
  }
}

export const authService = new AuthService();
