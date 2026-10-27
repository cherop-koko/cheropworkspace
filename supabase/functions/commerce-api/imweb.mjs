// REST API V2 read-only adapter. Never retain or log provider response bodies.
export class CommerceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const dayKST = (time = Date.now()) => new Date(Number(time) + 9 * 3600000).toISOString().slice(0, 10);
export function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new CommerceError('INVALID_DATE');
  return value;
}
export const addDays = (value, n) => new Date(Date.parse(day(value) + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const kstBounds = (from, to) => [Date.parse(day(from) + 'T00:00:00+09:00') / 1000, Date.parse(addDays(to, 1) + 'T00:00:00+09:00') / 1000 - 1];
const amount = v => v !== null && v !== undefined && v !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const id = v => { const s = String(v ?? ''); if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) throw new CommerceError('PROVIDER_ID_INVALID', 502); return s; };
const time = v => Number.isSafeInteger(Number(v)) && Number(v) > 946684800 && Number(v) < 4102444800 ? Number(v) * 1000 : null;
const paidStates = new Set(['PAY_COMPLETE', 'STANDBY', 'DELIVERING', 'COMPLETE', 'PURCHASE_CONFIRMATION', 'CANCEL', 'RETURN', 'EXCHANGE']);
export function normalizeOrder(order, groups, version) {
  if (!order || !Array.isArray(groups)) throw new CommerceError('PROVIDER_SHAPE_CHANGED', 502);
  const issues = new Set(), paidTimes = [], items = [], seen = new Set();
  for (const group of groups) {
    const groupId = id(group.order_no), paid = time(group.pay_time);
    if (paid) paidTimes.push(paid);
    const status = String(group.status || 'UNKNOWN').slice(0, 64);
    if (!paidStates.has(status) && status !== 'PAY_WAIT') issues.add('UNKNOWN_STATUS');
    if (['CANCEL', 'RETURN'].includes(status) || group.claim_type || group.claim_status) issues.add('REFUND_AMOUNT_DATE_UNAVAILABLE');
    if (!Array.isArray(group.items)) throw new CommerceError('PROVIDER_ITEMS_MISSING', 502);
    for (const item of group.items) {
      const itemId = groupId + ':' + id(item.no);
      if (seen.has(itemId)) throw new CommerceError('DUPLICATE_ITEM', 502);
      seen.add(itemId);
      const quantity = amount(item.payment?.count);
      if (quantity === null) issues.add('QUANTITY_UNAVAILABLE');
      items.push({ item_id: itemId, product_id: id(item.prod_no), name: String(item.prod_name || '상품명 미제공').slice(0, 240),
        sku: String(item.prod_sku_no || '').slice(0, 100), quantity, status,
        paid_date: paid ? dayKST(paid) : null, promotional: item.is_promotion === 'Y',
        canceled: status === 'CANCEL' || status === 'RETURN', claim_pending: Boolean(group.claim_type || group.claim_status) });
    }
  }
  if (!groups.length) issues.add('ITEMS_UNAVAILABLE');
  const uniqueDates = [...new Set(paidTimes.map(dayKST))];
  if (uniqueDates.length > 1) issues.add('MULTIPLE_PAYMENT_DATES');
  if (!paidTimes.length && groups.some(g => g.status !== 'PAY_WAIT')) issues.add('PAYMENT_DATE_UNAVAILABLE');
  const currency = String(order.payment?.price_currency || 'UNKNOWN').toUpperCase();
  let payment = amount(order.payment?.payment_amount);
  if (currency !== 'KRW') { issues.add('CURRENCY_UNVERIFIED'); payment = null; }
  if (payment === null) issues.add('PAYMENT_AMOUNT_UNAVAILABLE');
  const paidAt = paidTimes.length ? new Date(Math.min(...paidTimes)).toISOString() : null;
  // Explicit allowlist: no orderer, delivery, phone, address, invoice, free-text options or raw payload.
  return { order_id: id(order.order_no), version, ordered_at: time(order.order_time) ? new Date(time(order.order_time)).toISOString() : null,
    paid_at: paidAt, paid_date: uniqueDates.length === 1 ? uniqueDates[0] : null, currency,
    payment_amount: paidAt && uniqueDates.length === 1 ? payment : null,
    shipping_amount: amount(order.payment?.deliv_price), coupon_amount: amount(order.payment?.coupon), points_used: amount(order.payment?.point),
    refund_amount: null, refund_date: null, refund_verified: false, issues: [...issues].sort(), items };
}
export function listOf(result) {
  if (!result || Number(result.code) !== 200) throw new CommerceError('PROVIDER_RESPONSE_ERROR', 502);
  if (Array.isArray(result.data?.list)) return result.data.list;
  if (Array.isArray(result.data)) return result.data;
  throw new CommerceError('PROVIDER_SHAPE_CHANGED', 502);
}
export function createImweb({ key, secret, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, deadline = Date.now() + 80000 }) {
  if (!key || !secret) throw new CommerceError('CREDENTIALS_MISSING', 409);
  let token = null, next = 0;
  async function request(path, params = {}, auth = false, renewed = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, next - now());
      if (now() + wait + 1000 >= deadline) throw new CommerceError('SYNC_TIME_BUDGET', 503);
      if (wait) await sleep(wait);
      const url = new URL('https://api.imweb.me/v2/' + path);
      if (!auth) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      next = now() + (path === 'shop/orders' ? 1200 : 260);
      let response, result;
      try {
        // Official curl/PHP examples support POST JSON. Never put the secret in a URL.
        response = await fetcher(url.href, { method: auth ? 'POST' : 'GET', redirect: 'error',
          headers: auth ? { 'Content-Type': 'application/json' } : { 'access-token': token, Accept: 'application/json' },
          ...(auth ? { body: JSON.stringify({ key, secret }) } : {}),
          signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - now()))) });
        result = await response.json();
      } catch { if (attempt === 2) throw new CommerceError('PROVIDER_NETWORK_ERROR', 502); await sleep(1000 * (attempt + 1)); continue; }
      const code = Number(result.code || response.status);
      if (!auth && (code === 401 || response.status === 401) && !renewed) { token = null; await authenticate(); return request(path, params, false, true); }
      if (code === 429 || response.status === 429 || response.status >= 500 || code >= 500) {
        if (attempt === 2) throw new CommerceError(code === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_UNAVAILABLE', 503);
        const retry = Math.min(10000, Math.max(1200 * (attempt + 1), Number(response.headers?.get('retry-after') || 0) * 1000));
        await sleep(retry); continue;
      }
      if (!response.ok || code !== 200) throw new CommerceError(code === 401 || code === 403 ? 'PROVIDER_AUTH_REJECTED' : 'PROVIDER_REQUEST_REJECTED', 502);
      return result;
    }
  }
  async function authenticate() { const r = await request('auth', {}, true); if (typeof r.access_token !== 'string' || !r.access_token) throw new CommerceError('PROVIDER_TOKEN_MISSING', 502); token = r.access_token; }
  return {
    async page({ from, to, version, page }) {
      await authenticate(); const [a, b] = kstBounds(from, to);
      const rows = listOf(await request('shop/orders', { order_date_from: a, order_date_to: b, order_version: version, offset: page, limit: 10 }));
      if (rows.length > 10) throw new CommerceError('PAGINATION_UNVERIFIED', 502);
      const normalized = [];
      for (const row of rows) {
        const orderId = id(row.order_no);
        const parts = listOf(await request('shop/orders/' + encodeURIComponent(orderId) + '/prod-orders', { order_version: version, limit: 100, offset: 1 }));
        // Never silently truncate an unusually large order.
        if (parts.length >= 100) throw new CommerceError('ITEM_PAGINATION_REQUIRED', 502);
        normalized.push(normalizeOrder(row, parts, version));
      }
      return { orders: normalized, has_more: rows.length === 10 };
    }
  };
}

