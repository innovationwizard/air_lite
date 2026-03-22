const BASE_URL = '';

// Token storage key
const TOKEN_KEY = 'airefill_access_token';

export const apiClient = {
  // Store token from login response
  setToken(token: string) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
  },

  // Get stored token
  getToken(): string | null {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(TOKEN_KEY);
    }
    return null;
  },

  // Clear token on logout
  clearToken() {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  },

  async request(method: string, endpoint: string, data?: unknown, options?: RequestInit) {
    // Build headers object
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Merge existing headers if provided
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }
    
    // Add Authorization header as fallback if token is available
    const token = this.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const config: RequestInit = {
      method,
      credentials: 'include',
      headers,
      ...options
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return response.json();
  },

  async get(endpoint: string, options?: RequestInit) {
    return this.request('GET', endpoint, undefined, options);
  },

  async post(endpoint: string, data?: unknown, options?: RequestInit) {
    return this.request('POST', endpoint, data, options);
  },

  async put(endpoint: string, data?: unknown, options?: RequestInit) {
    return this.request('PUT', endpoint, data, options);
  },

  async delete(endpoint: string, options?: RequestInit) {
    return this.request('DELETE', endpoint, undefined, options);
  },

  async download(endpoint: string, data?: unknown, options?: RequestInit): Promise<Response> {
    const config: RequestInit = {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined,
      ...options
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response;
  }
};

export default apiClient;
