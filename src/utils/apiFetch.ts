/**
 * Shared client API fetch helper attaching Owner Bearer token and CSRF headers
 * for third-party iframe resilience.
 */

export function getCsrfToken(): string {
  const match = document.cookie.match(/leed_csrf=([^;]+)/);
  return match ? match[1] : '';
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  const token = localStorage.getItem('leed_session_token');
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf && !headers.has('x-leed-csrf-token')) {
      headers.set('x-leed-csrf-token', csrf);
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}
