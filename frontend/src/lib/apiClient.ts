// frontend/src/lib/apiClient.ts
// API Client configuration for path-based routing

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.airefill.app';
// NOT 'https://api.airefill.app/v1' - this would duplicate /v1 prefix

export { API_URL };

// Note: This file ensures the base API URL doesn't include /v1
// Individual service calls should add /v1 prefix as needed:
// Example: `${API_URL}/v1/auth/login` ✅
// NOT: `${API_URL}/v1/auth/login` where API_URL already contains /v1 ❌
