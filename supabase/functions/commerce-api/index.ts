/// <reference path="./runtime.d.ts" />
import { CommerceError, createImweb, day, dayKST, addDays } from './imweb.mjs';

const env = (key: string) => Deno.env.get(key) || '';
const base = env('SUPABASE_URL');
const serverKey = env('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default;
const origin = 'https://cherop-koko.github.io';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' };

async function db(path: string, method = 'GET', body?: unknown) {
  let response: Response;
  try { response = await fetch(base + '/rest/v1/' + path, { method, headers: { apikey: serverKey, Authorization: 'Bearer ' + serverKey,
    'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) }); }
  catch { throw new CommerceError('DATABASE_UNAVAILABLE', 503); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const known = ['LEASE_EXPIRED', 'PAGINATION_REPEATED', 'ORDER_VERSION_COLLISION', 'INVALID_RANGE', 'INVALID_BATCH'];
    throw new CommerceError(known.includes(result.message) ? result.message : 'DATABASE_ERROR', 503);
  }
  return response.status === 204 ? null : response.json();
}
const rpc = (name: string, body = {}) => db('rpc/' + name, 'POST', body);
const configured = () => Boolean(env('IMWEB_API_KEY') && env('IMWEB_SECRET_KEY'));
async function account() { return (await db('commerce_channels?id=eq.imweb&select=*'))[0]; }
async function authorize(req: Request) {
  const bearer = req.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ') || bearer.length > 8192) throw new CommerceError('SIGN_IN_REQUIRED', 401);
  let response: Response;
  try { response = await fetch(base + '/auth/v1/user', { headers: { apikey: serverKey, Authorization: bearer }, signal: AbortSignal.timeout(8000) }); }
  catch { throw new CommerceError('AUTH_UNAVAILABLE', 503); }
  if (!response.ok) throw new CommerceError('SIGN_IN_REQUIRED', 401);
  const identity = await response.json();
  if (!identity.id || !identity.email_confirmed_at || identity.is_anonymous) throw new CommerceError('ACCESS_DENIED', 403);
  const access = (await db('commerce_access?user_id=eq.' + encodeURIComponent(identity.id) + '&enabled=eq.true&select=member_id,role'))[0];
  if (!access) throw new CommerceError('ACCESS_DENIED', 403);
  return { ...access, id: identity.id };
}
function admin(actor: { role: string }) { if (actor.role !== 'admin') throw new CommerceError('ADMIN_REQUIRED', 403); }
const cleanCode = (e: unknown) => e instanceof CommerceError ? e.code : 'INTERNAL_ERROR';
async function worker() {
  if (!configured()) return { state: 'credentials_missing' };
  const job = await rpc('commerce_claim');
  if (!job) return { state: 'idle' };
  try {
    const client = createImweb({ key: env('IMWEB_API_KEY'), secret: env('IMWEB_SECRET_KEY'), deadline: Date.now() + 80000 });
    const page = await client.page({ from: job.from_date, to: job.to_date, version: job.versions[job.version_index], page: job.page });
    return await rpc('commerce_stage_page', { p_job: job.id, p_lease: job.lease_id, p_orders: page.orders, p_more: page.has_more });
  } catch (e) {
    await rpc('commerce_fail', { p_job: job.id, p_lease: job.lease_id, p_code: cleanCode(e) });
    return { state: 'retry_or_failed', code: cleanCode(e) };
  }
}
function range(url: URL) {
  const from = day(url.searchParams.get('from') || addDays(dayKST(), -1));
  const to = day(url.searchParams.get('to') || from), grain = url.searchParams.get('grain') || 'day';
  if (to < from || to > dayKST() || Date.parse(to) - Date.parse(from) > 366 * 86400000 || !['day', 'month'].includes(grain)) throw new CommerceError('INVALID_RANGE');
  return { p_from: from, p_to: to, p_grain: grain };
}
async function report(url: URL) {
  const dates = range(url), channel = await account();
  const result = await rpc('commerce_report', dates);
  const coverage = channel.last_full_from && channel.last_full_from <= dates.p_from && channel.last_full_to >= dates.p_to;
  result.coverage = coverage ? 'collected' : channel.last_success_at ? 'partial' : 'not_collected';
  result.last_success_at = channel.last_success_at;
  result.last_error = channel.last_error;
  if (!channel.last_success_at) result.summary = { observed_payment: null, observed_orders: null, average_order_value: null, refund_amount: null, net_sales: null, settlement_amount: null };
  else if (coverage && !channel.last_error && result.summary.observed_payment === null && result.summary.observed_orders === 0 && result.summary.unpriced_orders === 0 && result.undated_orders === 0) result.summary.observed_payment = 0;
  result.channels = [
    { id: 'imweb', name: '아임웹 자사몰', connected: configured(), status: !configured() ? 'not_connected' : channel.last_error ? 'failed' : channel.last_success_at ? 'collected_unverified' : 'awaiting_collection', ...result.summary },
    { id: 'smartstore', name: '스마트스토어', connected: false, status: 'fixed_egress_ip_required' },
    { id: 'kakao_gift', name: '카카오 선물하기', connected: false, status: 'seller_api_approval_required' }
  ];
  return result;
}
// Read-only legacy comparison. Never update, insert, delete, or merge legacy records.
async function comparison(url: URL) {
  const dates = range(url);
  const daily = new Map<string, { amount: number; rows: number; invalid: boolean }>();
  let count = 0, invalid = 0;
  for (let offset = 0; ; offset += 1000) {
    if (offset >= 100000) throw new CommerceError('COMPARISON_TOO_LARGE', 422);
    const query = 'channel_sales_log?select=id,date,amount&channel=eq.' + encodeURIComponent('자사몰') +
      '&date=gte.' + dates.p_from + '&date=lte.' + dates.p_to + '&order=date.asc,id.asc&limit=1000&offset=' + offset;
    const rows = await db(query);
    if (!Array.isArray(rows)) throw new CommerceError('DATABASE_ERROR', 503);
    for (const row of rows) {
      count++;
      const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
      const bucket = String(row.date).slice(0, 10), item = daily.get(bucket) || { amount: 0, rows: 0, invalid: false };
      item.rows++;
      if (row.amount === null || row.amount === '' || !Number.isSafeInteger(amount)) { invalid++; item.invalid = true; }
      else item.amount += amount;
      daily.set(bucket, item);
    }
    if (rows.length < 1000) break;
  }
  return { from: dates.p_from, to: dates.p_to, source: 'manual', channel: '자사몰', rows: count,
    amount: count && !invalid ? [...daily.values()].reduce((n, x) => n + x.amount, 0) : null,
    invalid_amount_rows: invalid, comparison_basis: 'unverified',
    buckets: [...daily].map(([bucket, x]) => ({ bucket, amount: x.invalid ? null : x.amount, rows: x.rows })),
    included_in_api_total: false };
}

function integer(value: unknown) { const n = Number(value); if (value === '' || value === null || value === undefined || !Number.isSafeInteger(n) || n < 0) throw new CommerceError('INVALID_NUMBER'); return n; }

Deno.serve(async req => {
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) return new Response(null, { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const url = new URL(req.url), action = url.pathname.split('/').filter(Boolean).at(-1);
    if (action === 'tick') throw new CommerceError('SCHEDULER_DISABLED', 409);
    const actor = await authorize(req);
    if (req.method === 'GET' && action === 'status') {
      return new Response(JSON.stringify({ actor: { member_id: actor.member_id, role: actor.role }, credentials_present: configured(),
        capabilities: { connection_check: true, manual_advance: true, comparison: true, cutover: false }, channel: await account(), jobs: await db('commerce_jobs?select=id,kind,from_date,to_date,status,error_code,page,version_index,orders_count,created_at,completed_at&order=created_at.desc&limit=12'),
        checks: await db('commerce_checks?select=from_date,to_date,payment_matches,refund_verified,checked_at&order=checked_at.desc&limit=5'),
        refund_support: 'unverified', fixed_egress_ip: false, chatgpt_connected: false }), { headers });
    }
    if (req.method === 'GET' && action === 'report') return new Response(JSON.stringify(await report(url)), { headers });
    admin(actor);
    if (req.method === 'POST' && action === 'connection') {
      const client = createImweb({ key: env('IMWEB_API_KEY'), secret: env('IMWEB_SECRET_KEY'), deadline: Date.now() + 30000 });
      await client.checkConnection();
      return new Response(JSON.stringify({ authenticated: true, orders_collected: false, checked_at: new Date().toISOString() }), { headers });
    }
    if (req.method === 'GET' && action === 'comparison') return new Response(JSON.stringify(await comparison(url)), { headers });
    if (req.method === 'POST' && action === 'advance') return new Response(JSON.stringify(await worker()), { headers });
    if (req.method !== 'POST' || !['sync', 'settings', 'check'].includes(action || '')) throw new CommerceError('NOT_FOUND', 404);
    const raw = await req.text(); if (raw.length > 4096) throw new CommerceError('BODY_TOO_LARGE', 413);
    let body; try { body = JSON.parse(raw); } catch { throw new CommerceError('INVALID_JSON'); }
    if (action === 'settings') {
      const historyStart = day(body.history_start), versions = body.versions;
      if (historyStart > dayKST() || historyStart < '2000-01-01' || !Array.isArray(versions) || !versions.length || new Set(versions).size !== versions.length || versions.some(v => !['v1', 'v2'].includes(v)) || typeof body.schedule_enabled !== 'boolean') throw new CommerceError('INVALID_SETTINGS');
      if (body.schedule_enabled) throw new CommerceError('SCHEDULER_DISABLED', 409);
      const active = await db('commerce_jobs?status=in.(queued,running)&select=id&limit=1');
      const current = await account();
      if (active.length && (current.history_start !== historyStart || JSON.stringify(current.versions) !== JSON.stringify(versions))) throw new CommerceError('SYNC_IN_PROGRESS', 409);
      await db('commerce_channels?id=eq.imweb', 'PATCH', { history_start: historyStart, versions, schedule_enabled: body.schedule_enabled, updated_at: new Date().toISOString(),
        ...(current.history_start !== historyStart || JSON.stringify(current.versions) !== JSON.stringify(versions) ? { last_full_from: null, last_full_to: null } : {}) });
      return new Response(JSON.stringify({ saved: true }), { headers });
    }
    if (action === 'sync') {
      if (!configured()) throw new CommerceError('CREDENTIALS_MISSING', 409);
      const current = await account(); if (!current.history_start) throw new CommerceError('HISTORY_START_REQUIRED', 409);
      const full = body.kind === 'reconcile', from = full ? current.history_start : day(body.from), to = full ? dayKST() : day(body.to);
      if (to < from || to > dayKST() || from < current.history_start || (!full && Date.parse(to) - Date.parse(from) > 31 * 86400000)) throw new CommerceError('INVALID_RANGE');
      const job = await rpc('commerce_enqueue', { p_kind: full ? 'reconcile' : 'manual', p_from: from, p_to: to });
      // Queue survives navigation. Authenticated manual advance processes subsequent pages; cron stays disabled.
      EdgeRuntime.waitUntil(worker().catch(() => undefined));
      return new Response(JSON.stringify({ job_id: job, state: 'queued' }), { status: 202, headers });
    }
    if (action === 'check') {
      url.searchParams.set('from', day(body.from)); url.searchParams.set('to', day(body.to));
      const result = await report(url), payment = integer(body.payment), orders = integer(body.orders), refunds = integer(body.refunds);
      const matches = result.coverage === 'collected' && !result.last_error && result.undated_orders === 0 && result.summary.unpriced_orders === 0 && result.summary.observed_payment === payment && result.summary.observed_orders === orders;
      await db('commerce_checks', 'POST', { from_date: body.from, to_date: body.to, expected_payment: payment, expected_orders: orders, expected_refund: refunds,
        observed_payment: result.summary.observed_payment, observed_orders: result.summary.observed_orders, payment_matches: matches, refund_verified: false, checked_by: actor.id });
      return new Response(JSON.stringify({ payment_matches: matches, refund_verified: false, integration_verified: false }), { headers });
    }
    throw new CommerceError('NOT_FOUND', 404);
  } catch (e) {
    // Deliberately no console.error, raw provider bodies, URLs, auth headers or stack traces.
    return new Response(JSON.stringify({ error: cleanCode(e) }), { status: e instanceof CommerceError ? e.status : 500, headers });
  }
});

