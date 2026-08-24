/** Admin API client backed by a short-lived Supabase Auth session. */

const SESSION_KEY = 'rl-link-admin-session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

async function parseResponse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }
  if (!res.ok) {
    const message = Array.isArray(data?.errors)
      ? data.errors.join('\n')
      : data?.error || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function login(email, password) {
  const res = await fetch('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return setSession(await parseResponse(res));
}

async function refreshSession() {
  const current = getSession();
  if (!current?.refreshToken) throw new Error('Your session has expired. Please sign in again.');
  const res = await fetch('/api/admin/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  return setSession(await parseResponse(res));
}

async function request(method, url, body, allowRefresh = true) {
  const session = getSession();
  const headers = session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {};
  let payload;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  if (res.status === 401 && allowRefresh && session?.refreshToken) {
    try {
      await refreshSession();
      return request(method, url, body, false);
    } catch {
      clearSession();
      throw new Error('Your session has expired. Please sign in again.');
    }
  }
  return parseResponse(res);
}

export const fetchConfig = () => request('GET', '/api/admin/config');
export const createApp = (app) => request('POST', '/api/admin/apps', app);
export const updateApp = (slug, app) => request('PUT', `/api/admin/apps/${slug}`, app);
export const removeApp = (slug) => request('DELETE', `/api/admin/apps/${slug}`);

export function uploadIcon(slug, file) {
  const form = new FormData();
  form.append('icon', file);
  return request('POST', `/api/admin/apps/${slug}/icon`, form);
}
