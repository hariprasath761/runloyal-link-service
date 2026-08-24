import {
  ADMIN_EMAILS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '../config.js';

const allowedEmails = new Set(
  ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
);

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || allowedEmails.size === 0) {
    throw new AuthError(
      'Admin email login requires SUPABASE_URL, SUPABASE_ANON_KEY, and ADMIN_EMAILS',
      503,
    );
  }
}

function isAllowed(user) {
  return Boolean(user?.email && allowedEmails.has(String(user.email).toLowerCase()));
}

async function authRequest(path, { accessToken, body } = {}) {
  assertConfigured();
  let response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Unable to reach Supabase Auth', 502);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 400 ? 401 : response.status;
    throw new AuthError(payload?.msg || payload?.error_description || 'Authentication failed', status);
  }
  return payload;
}

function publicSession(payload) {
  if (!isAllowed(payload.user)) throw new AuthError('This account is not an authorized admin', 403);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    user: { email: payload.user.email },
  };
}

export async function loginAdmin(email, password) {
  const payload = await authRequest('token?grant_type=password', {
    body: { email: String(email || '').trim(), password: String(password || '') },
  });
  return publicSession(payload);
}

export async function refreshAdmin(refreshToken) {
  const payload = await authRequest('token?grant_type=refresh_token', {
    body: { refresh_token: String(refreshToken || '') },
  });
  return publicSession(payload);
}

export async function verifyAdmin(accessToken) {
  if (!accessToken) throw new AuthError('Authentication required', 401);
  const user = await authRequest('user', { accessToken });
  if (!isAllowed(user)) throw new AuthError('This account is not an authorized admin', 403);
  return { email: user.email };
}
