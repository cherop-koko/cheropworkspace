/* Shared login only. No business data, member PINs or service secrets. */
(() => {
  'use strict';
  let client, config;
  function getClient(url, publishableKey) {
    if (!client) {
      config = url ? { url, publishableKey } : window.CHEROPCommerceConfig;
      client = window.supabase.createClient(config.url, config.publishableKey, { auth: {
        storage: window.localStorage, storageKey: 'cherop-workspace-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false
      } });
    }
    return client;
  }
  async function call(action, body, token) {
    getClient();
    let response;
    try {
      response = await fetch(config.url + '/functions/v1/workspace-auth/' + action, { method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(40000) });
    } catch { throw Object.assign(new Error(), { code: 'AUTH_UNAVAILABLE' }); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(), { code: result.error || 'AUTH_UNAVAILABLE' });
    return result;
  }
  async function profile() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw Object.assign(new Error(), { code: 'SIGN_IN_REQUIRED' });
    if (!data.session) return null;
    // Stored claims are not authorization. The server fetches current Auth metadata.
    return (await call('session', undefined, data.session.access_token)).profile;
  }
  async function login(memberId, password) {
    const result = await call('login', { member_id: memberId, password });
    const { error } = await getClient().auth.setSession(result.session);
    if (error) throw Object.assign(new Error(), { code: 'SIGN_IN_REQUIRED' });
    return await profile();
  }
  async function logout() {
    // local scope removes the shared browser session and broadcasts to other tabs.
    const { error } = await getClient().auth.signOut({ scope: 'local' });
    if (error) throw Object.assign(new Error(), { code: 'AUTH_UNAVAILABLE' });
  }
  const messages = { INVALID_LOGIN: '이름과 비밀번호를 확인해 주세요.', SIGN_IN_REQUIRED: '다시 로그인해 주세요.', ACCESS_DENIED: '계정의 접근 권한을 확인해 주세요.', AUTH_SETUP_REQUIRED: '계정 연결 설정을 확인해야 합니다.', TRY_LATER: '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.', AUTH_UNAVAILABLE: '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  window.CHEROPWorkspaceAuth = { getClient, profile, login, logout, errorText: error => messages[error?.code] || messages.AUTH_UNAVAILABLE };
})();
