import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const env = (key: string) => Deno.env.get(key) || '';
const units = new Set(['Matriz Caicó', 'Filial Pau dos Ferros']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const scriptUrl = env('RATING_GOOGLE_SCRIPT_URL');
  const bridgeSecret = env('RATING_GOOGLE_BRIDGE_SECRET');
  const authHeader = req.headers.get('Authorization') || '';
  if (!url || !anonKey) return json({ ok: false, error: 'SERVER_CONFIG_MISSING' }, 500);
  if (!scriptUrl || !bridgeSecret) return json({ ok: false, error: 'RATING_BRIDGE_NOT_CONFIGURED' }, 503);
  try {
    const parsedUrl = new URL(scriptUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'script.google.com'
        || !parsedUrl.pathname.startsWith('/macros/s/') || !parsedUrl.pathname.endsWith('/exec')) {
      return json({ ok: false, error: 'RATING_BRIDGE_URL_INVALID' }, 500);
    }
  } catch {
    return json({ ok: false, error: 'RATING_BRIDGE_URL_INVALID' }, 500);
  }
  if (!authHeader.startsWith('Bearer ')) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  const userDb = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userDb.auth.getUser();
  if (authError || !userData?.user) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ ok: false, error: 'INVALID_BODY' }, 400); }
  const action = String(input.action || '');
  const unit = String(input.unit || '');
  if (!['list', 'save'].includes(action) || !units.has(unit)) {
    return json({ ok: false, error: 'INVALID_INPUT' }, 400);
  }

  const permissionCodes = action === 'save' ? ['RATING_EDIT'] : ['RATING_VIEW', 'RATING_EDIT'];
  let permitted = false;
  for (const code of permissionCodes) {
    const { data, error } = await userDb.rpc('has_permission', { p_code: code });
    if (error) {
      console.error('rating permission check', error);
      return json({ ok: false, error: 'PERMISSION_CHECK_FAILED' }, 500);
    }
    if (data === true) { permitted = true; break; }
  }
  if (!permitted) return json({ ok: false, error: 'FORBIDDEN' }, 403);

  const { data: hasUnit, error: unitError } = await userDb.rpc('user_has_unit', { p_unit: unit });
  if (unitError) {
    console.error('rating unit check', unitError);
    return json({ ok: false, error: 'UNIT_CHECK_FAILED' }, 500);
  }
  if (hasUnit !== true) return json({ ok: false, error: 'UNIT_FORBIDDEN' }, 403);

  const payload: Record<string, unknown> = {
    action,
    unit,
    secret: bridgeSecret,
  };
  if (action === 'save') {
    const rowNumber = Number(input.rowNumber);
    const comment = input.comment;
    const expected = input.expected;
    if (typeof comment !== 'string' || !Number.isInteger(rowNumber) || rowNumber < 2 || comment.length > 5000
        || rowNumber > 1000000 || !isRecord(expected)
        || typeof expected.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expected.fingerprint)) {
      return json({ ok: false, error: 'INVALID_INPUT' }, 400);
    }
    payload.rowNumber = rowNumber;
    payload.comment = comment;
    payload.expected = expected;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      console.error('rating script HTTP status', response.status);
      return json({ ok: false, error: 'RATING_SHEET_UNAVAILABLE' }, 502);
    }
    const result = await response.json();
    if (result?.ok !== true) {
      const status = result?.error === 'ROW_CHANGED' ? 409
        : result?.error === 'UNAUTHORIZED' ? 502 : 422;
      return json({ ok: false, error: String(result?.error || 'RATING_SHEET_ERROR') }, status);
    }
    if (action === 'save' && (typeof result.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(result.fingerprint))) {
      return json({ ok: false, error: 'RATING_SHEET_RESPONSE_INVALID' }, 502);
    }
    return json(result);
  } catch (error) {
    console.error('rating sheet request failed', error);
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json({ ok: false, error: timedOut ? 'RATING_SHEET_TIMEOUT' : 'RATING_SHEET_UNAVAILABLE' }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
