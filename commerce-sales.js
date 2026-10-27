/* Standalone verification page. No imports from the legacy app and no legacy DB writes. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.CHEROPCommerceConfig;
  let client, status, busy = false, stop = false, generation = 0, reportRequest = 0;
  const money = n => Number.isFinite(n) ? n.toLocaleString('ko-KR') + '원' : '—';
  const codes = { SIGN_IN_REQUIRED: '로그인이 필요합니다.', ACCESS_DENIED: '이 계정에는 조회 권한이 없습니다.', ADMIN_REQUIRED: '관리자 권한이 필요합니다.', CREDENTIALS_MISSING: '아임웹 서버 키 등록을 기다리고 있습니다.', HISTORY_START_REQUIRED: '수집 시작일을 설정해 주세요.', PROVIDER_AUTH_REJECTED: '아임웹 인증 정보를 확인해야 합니다.', PROVIDER_RATE_LIMIT: '아임웹 조회 제한으로 수집을 잠시 멈췄습니다.', INVALID_RANGE: '조회 기간을 확인해 주세요.', SCHEDULER_DISABLED: '예약 수집은 비활성 상태입니다.', NETWORK_ERROR: '연결하지 못했습니다. 마지막 조회 결과를 유지합니다.', SYNC_IN_PROGRESS: '수집 중에는 시작일을 바꿀 수 없습니다.', NOT_FOUND: '서버 업데이트가 아직 적용되지 않았습니다.' };
  function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
  function errorText(e) { return codes[e.code] || '요청을 완료하지 못했습니다. 마지막 정상 결과는 유지됩니다.'; }
  function clearPrivate() {
    generation++; stop = true; status = null;
    $('connected-panel').hidden = true; $('login-panel').hidden = false;
    ['manual-amount','api-amount','difference'].forEach(id => $(id).textContent = '—');
    $('daily').replaceChildren(); $('password').value = '';
  }
  async function api(action, options = {}) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw Object.assign(new Error(), { code: 'SIGN_IN_REQUIRED' });
    const response = await fetch(config.api + '/' + action, {
      method: options.body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
      headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(100000)
    }).catch(() => { throw Object.assign(new Error(), { code: 'NETWORK_ERROR' }); });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearPrivate();
      throw Object.assign(new Error(), { code: body.error || 'NETWORK_ERROR' });
    }
    return body;
  }
  function controls() {
    $('sync').disabled = busy || !status?.credentials_present || status.actor?.role !== 'admin' || !status.capabilities?.manual_advance;
    $('range-form').querySelector('[type=submit]').disabled = busy;
    $('pause').hidden = !busy;
  }
  async function refreshStatus() {
    const ticket = generation, next = await api('status');
    if (ticket !== generation) return;
    if (next.actor?.role !== 'admin') throw Object.assign(new Error(), { code: 'ADMIN_REQUIRED' });
    status = next; $('login-panel').hidden = true; $('connected-panel').hidden = false;
    $('connection-status').textContent = !next.credentials_present ? '서버 키 등록 대기' : !next.capabilities?.manual_advance ? '검증 화면용 서버 업데이트 대기' : '키 등록됨 · 실주문 대조 필요';
    $('last-sync').textContent = next.channel.last_success_at ? '최근 수집 ' + new Date(next.channel.last_success_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '최근 수집 · 아직 없음';
    controls(); return next;
  }
  function range() {
    const from = $('from').value, to = $('to').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Object.assign(new Error(), { code: 'INVALID_RANGE' });
    return { from, to, query: '?from=' + from + '&to=' + to + '&grain=day' };
  }
  function renderReport(report, manual) {
    const sum = report.summary || {}, collected = report.coverage === 'collected' && !report.last_error;
    const automatic = Number.isFinite(sum.observed_payment) ? sum.observed_payment : null;
    const manualAmount = manual?.amount ?? null;
    $('manual-amount').textContent = money(manualAmount);
    $('manual-count').textContent = manual ? `${manual.rows}건 · ${manual.from} ~ ${manual.to}` : '서버 업데이트 후 조회 가능';
    $('api-amount').textContent = money(automatic);
    $('api-count').textContent = report.coverage === 'not_collected' ? '미수집' : `${sum.observed_orders ?? '—'}건 · ${report.from} ~ ${report.to}`;
    $('difference').textContent = collected && Number.isFinite(automatic) && Number.isFinite(manualAmount) ? money(automatic - manualAmount) : '—';
    // Refunds and net sales are intentionally not promoted to verified values by this screen.
    $('refund').textContent = '미검증'; $('net').textContent = '미검증';
    $('coverage').textContent = collected ? '선택 기간 수집됨 · 금액 기준 검증 전' : '선택 기간 전체 수집 미확인';
    const autoRows = new Map((report.buckets || []).map(x => [x.bucket, x]));
    const manualRows = new Map((manual?.buckets || []).map(x => [x.bucket, x]));
    const days = [...new Set([...autoRows.keys(), ...manualRows.keys()])].sort();
    $('daily').replaceChildren();
    for (const day of days) {
      const a = autoRows.get(day)?.payment_amount ?? null, m = manualRows.get(day)?.amount ?? null;
      const row = document.createElement('tr');
      [day, money(m), money(a), collected && Number.isFinite(a) && Number.isFinite(m) ? money(a - m) : '—'].forEach(value => { const td = document.createElement('td'); td.textContent = value; row.append(td); });
      $('daily').append(row);
    }
    if (!days.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 4; cell.className = 'empty'; cell.textContent = '이 기간에 대조할 수집 결과가 없습니다.'; row.append(cell); $('daily').append(row); }
    $('orders-check').textContent = status?.checks?.some(x => x.from_date === report.from && x.to_date === report.to && x.payment_matches) ? '결제 대조 기록 있음 · 최종 확인 필요' : '실주문 검증 전';
    notice(`${report.from} ~ ${report.to} 조회 결과입니다. 수기·API 금액은 별도이며, 차액만으로 오류나 일치를 확정하지 않습니다.`);
  }
  async function loadReport() {
    const ticket = generation, request = ++reportRequest, dates = range();
    const [report, manual] = await Promise.all([api('report' + dates.query), status?.capabilities?.comparison ? api('comparison' + dates.query) : Promise.resolve(null)]);
    if (ticket !== generation || request !== reportRequest) return;
    renderReport(report, manual);
  }
  async function synchronize() {
    if (busy || $('sync').disabled) return;
    const dates = range(); busy = true; stop = false; controls();
    const ticket = generation;
    try {
      if (!status.channel.history_start) {
        if (!window.confirm(`${dates.from}부터의 주문을 별도 수집합니다. 기존 수기 내역은 유지됩니다. 시작할까요?`)) return;
        await api('settings', { body: { history_start: dates.from, versions: status.channel.versions, schedule_enabled: false } });
      }
      const pending = status.jobs?.some(j => ['queued','running'].includes(j.status));
      if (!pending) await api('sync', { body: { kind: 'reconcile' } });
      for (let step = 0; step < 4 && !stop && ticket === generation; step++) {
        $('sync-state').textContent = '주문을 나누어 수집하고 있습니다. 진행 중인 한 묶음은 화면을 닫아도 마무리될 수 있습니다.';
        await api('advance', { body: {} });
        if (stop || ticket !== generation) break;
        await refreshStatus();
        if (!status?.jobs?.some(j => ['queued','running'].includes(j.status))) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (ticket !== generation) return;
      await refreshStatus(); await loadReport();
      $('sync-state').textContent = status?.jobs?.some(j => ['queued','running'].includes(j.status)) ? '남은 작업이 있습니다. 동기화를 다시 누르면 이어서 가져옵니다.' : '수집 상태를 갱신했습니다. 실패·재시도 여부와 금액을 확인해 주세요.';
    } catch (e) { notice(errorText(e), true); }
    finally { busy = false; controls(); }
  }
  async function start() {
    if (!config || !window.supabase) { notice('화면을 불러오지 못했습니다. 새로고침해 주세요.', true); return; }
    client = window.supabase.createClient(config.url, config.publishableKey, { auth: { storage: sessionStorage, storageKey: 'cherop-commerce-verification-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
    $('to').value = today; $('from').value = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0,10);
    $('login-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
      try { const result = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value }); $('password').value = ''; if (result.error) throw Object.assign(new Error(), { code:'SIGN_IN_REQUIRED' }); await refreshStatus(); await loadReport(); }
      catch(e) { notice(errorText(e), true); } finally { button.disabled = false; }
    });
    $('range-form').addEventListener('submit', async event => { event.preventDefault(); try { await loadReport(); } catch(e) { notice(errorText(e), true); } });
    $('sync').addEventListener('click', () => synchronize().catch(e => notice(errorText(e), true)));
    $('pause').addEventListener('click', () => { stop = true; $('sync-state').textContent = '진행 중인 묶음 이후 추가 수집을 멈춥니다.'; });
    $('logout').addEventListener('click', async () => { clearPrivate(); await client.auth.signOut({ scope:'local' }); notice('로그아웃했습니다.'); });
    window.addEventListener('pagehide', () => { stop = true; generation++; });
    client.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') clearPrivate(); });
    try { const { data } = await client.auth.getSession(); if (data.session) { await refreshStatus(); await loadReport(); } } catch(e) { notice(errorText(e), true); }
  }
  window.CHEROPCommerceVerification = { renderReport, money };
  start();
})();
