/**
 * Admin API client.
 *
 * The bearer token is held in sessionStorage rather than localStorage: this is
 * a shared PoC secret, and it should not survive a closed tab.
 */

const TOKEN_KEY = 'rl-link-admin-token';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

async function request(method, url, body) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  let payload;

  if (body instanceof FormData) {
    payload = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });

  if (res.status === 401) {
    clearToken();
    throw new Error('Unauthorized — check the admin token');
  }
  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }

  if (!res.ok) {
    // The API returns `errors: []` for validation failures and `error` for
    // everything else. Flatten both into one message.
    const message = Array.isArray(data?.errors)
      ? data.errors.join('\n')
      : data?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const fetchConfig = () => request('GET', '/api/admin/config');
export const fetchWellKnown = () => request('GET', '/api/admin/wellknown');
export const saveSettings = (portalUrl) => request('PUT', '/api/admin/settings', { portalUrl });
export const createApp = (app) => request('POST', '/api/admin/apps', app);
export const updateApp = (slug, app) => request('PUT', `/api/admin/apps/${slug}`, app);
export const removeApp = (slug) => request('DELETE', `/api/admin/apps/${slug}`);
export const saveLegacyCode = (code, mapping) =>
  request('PUT', `/api/admin/legacy/${encodeURIComponent(code)}`, mapping);
export const removeLegacyCode = (code) =>
  request('DELETE', `/api/admin/legacy/${encodeURIComponent(code)}`);

export function uploadIcon(slug, file) {
  const form = new FormData();
  form.append('icon', file);
  return request('POST', `/api/admin/apps/${slug}/icon`, form);
}
