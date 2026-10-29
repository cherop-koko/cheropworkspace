import { members, workspaceProfile } from '../_shared/workspace-identity.mjs';

class AuthError extends Error {
  constructor(code, status = 401) { super(code); this.code = code; this.status = status; }
}
export function createHandler({ env, request = fetch }) {
  const base = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default;
  const origin = 'https://cherop-koko.github.io';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' };
  async function auth(path, method = 'GET', body, bearer = key) {
    let response;
    try {
      response = await request(base + '/auth/v1/' + path, { method, headers: { apikey: key, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    } catch { throw new AuthError('AUTH_UNAVAILABLE', 503); }
    if (response.status === 429) throw new AuthError('TRY_LATER', 429);
    if (response.status >= 500) throw new AuthError('AUTH_UNAVAILABLE', 503);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  }
  async function sameSecret(left, right) {
    const encoder = new TextEncoder();
    const [a, b] = await Promise.all([left, right].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
    const bytes = new Uint8Array(b);
    return new Uint8Array(a).reduce((diff, byte, i) => diff | (byte ^ bytes[i]), 0) === 0;
  }
  // Bootstrap is only for a previously nonexistent Auth identity. It never resets
  // passwords or assigns roles to an existing account (including email collisions).
  async function login(memberId, password) {
    if (typeof memberId !== 'string' || !Object.hasOwn(members, memberId) || typeof password !== 'string' || password.length < 1 || password.length > 128) throw new AuthError('INVALID_LOGIN');
    const credentials = { email: memberId + '@workspace.cherop.invalid', password };
    let result = await auth('token?grant_type=password', 'POST', credentials);
    if (!result.ok) {
      // Never bypass provider throttling, CAPTCHA, disabled accounts or other errors.
      if (result.body.error_code !== 'invalid_credentials') throw new AuthError('INVALID_LOGIN');
      const seed = env('WORKSPACE_PASSWORD_' + memberId.toUpperCase()) || '';
      const strong = seed.length >= 12 && seed.length <= 128 && /[A-Za-z]/.test(seed) && /[^A-Za-z]/.test(seed);
      const unique = Object.keys(members).every(id => id === memberId || env('WORKSPACE_PASSWORD_' + id.toUpperCase()) !== seed);
      if (!strong || !unique || !(await sameSecret(password, seed))) throw new AuthError('INVALID_LOGIN');
      const created = await auth('admin/users', 'POST', { ...credentials, email_confirm: true,
        app_metadata: { workspace_member_id: memberId, workspace_enabled: true } });
      // A parallel first login may have just created the same identity. Only retry
      // password authentication; never modify that account or its trusted metadata.
      if (!created.ok && !['email_exists', 'user_already_exists'].includes(created.body.error_code)) throw new AuthError('AUTH_SETUP_REQUIRED', 503);
      result = await auth('token?grant_type=password', 'POST', credentials);
    }
    if (!result.ok) throw new AuthError('INVALID_LOGIN');
    const profile = workspaceProfile(result.body.user);
    if (!profile || profile.id !== memberId) throw new AuthError('ACCESS_DENIED', 403);
    if (!result.body.access_token || !result.body.refresh_token) throw new AuthError('AUTH_UNAVAILABLE', 503);
    return { profile, session: { access_token: result.body.access_token, refresh_token: result.body.refresh_token } };
  }
  return async req => {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    try {
      if (req.headers.get('origin') && req.headers.get('origin') !== origin) throw new AuthError('ACCESS_DENIED', 403);
      const action = new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
      let result;
      if (req.method === 'POST' && action === 'login') {
        if (!req.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('INVALID_REQUEST', 400);
        if (Number(req.headers.get('content-length')) > 2048) throw new AuthError('INVALID_REQUEST', 413);
        const raw = await req.text();
        if (raw.length > 2048) throw new AuthError('INVALID_REQUEST', 413);
        let body; try { body = JSON.parse(raw); } catch { throw new AuthError('INVALID_REQUEST', 400); }
        result = await login(body?.member_id, body?.password);
      } else if (req.method === 'GET' && action === 'session') {
        const bearer = req.headers.get('authorization') || '';
        if (!bearer.startsWith('Bearer ') || bearer.length > 8192) throw new AuthError('SIGN_IN_REQUIRED');
        const identity = await auth('user', 'GET', undefined, bearer.slice(7));
        if (!identity.ok) throw new AuthError('SIGN_IN_REQUIRED');
        const profile = workspaceProfile(identity.body);
        if (!profile) throw new AuthError('ACCESS_DENIED', 403);
        result = { profile };
      } else throw new AuthError('NOT_FOUND', 404);
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof AuthError ? error.code : 'AUTH_UNAVAILABLE' }), { status: error instanceof AuthError ? error.status : 503, headers });
    }
  };
}
