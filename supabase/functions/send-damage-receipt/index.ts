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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanCode = (value: unknown) => String(value || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
const cleanText = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const dateBR = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};
const quantityText = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const token = env('WHATSAPP_ACCESS_TOKEN');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = env('WHATSAPP_TEMPLATE_NAME') || 'comprovante_avaria_entrega';
  const language = env('WHATSAPP_TEMPLATE_LANGUAGE') || 'pt_BR';
  const graphVersion = env('WHATSAPP_GRAPH_VERSION') || 'v26.0';
  if (!url || !anonKey || !serviceKey) return json({ error: 'SERVER_CONFIG_MISSING' }, 500);
  if (!token || !/^\d+$/.test(phoneId) || !/^v\d+\.\d+$/.test(graphVersion)) return json({ error: 'WHATSAPP_NOT_CONFIGURED' }, 503);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'UNAUTHORIZED' }, 401);
  const userDb = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminDb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userDb.auth.getUser();
  if (authError || !userData?.user) return json({ error: 'UNAUTHORIZED' }, 401);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: 'INVALID_BODY' }, 400); }
  const requestId = String(input?.request_id || '');
  const contactId = String(input?.contact_id || '');
  if (!uuid.test(requestId) || !uuid.test(contactId)) return json({ error: 'INVALID_BODY' }, 400);

  // RLS e a autoria da avaria limitam o motorista aos próprios comprovantes.
  const { data: damage, error: damageError } = await userDb.from('damage_requests')
    .select('id,created_by,customer_code,customer_name,map_number,occurrence_date')
    .eq('id', requestId).eq('created_by', userData.user.id).maybeSingle();
  if (damageError) { console.error('receipt request lookup', damageError); return json({ error: 'RECEIPT_LOOKUP_FAILED' }, 500); }
  if (!damage) return json({ error: 'RECEIPT_NOT_FOUND' }, 404);

  const { data: contact, error: contactError } = await userDb.from('customer_contacts')
    .select('id,customer_id,customer_code,phone_normalized,whatsapp_receipt_eligible,whatsapp_receipt_verified_at,whatsapp_receipt_verified_by')
    .eq('id', contactId).maybeSingle();
  if (contactError) { console.error('receipt contact lookup', contactError); return json({ error: 'CONTACT_LOOKUP_FAILED' }, 500); }
  if (!contact || cleanCode(contact.customer_code) !== cleanCode(damage.customer_code)
      || !/^55\d{10,11}$/.test(String(contact.phone_normalized || ''))) {
    return json({ error: 'CONTACT_NOT_FOUND' }, 404);
  }
  // O aceite do destinatário, a maioridade e o país são registrados antes do envio.
  // Contatos antigos ou ainda não validados permanecem bloqueados.
  if (contact.whatsapp_receipt_eligible !== true || !contact.whatsapp_receipt_verified_at || !contact.whatsapp_receipt_verified_by) {
    return json({ error: 'CONTACT_NOT_ELIGIBLE' }, 403);
  }
  const { data: customer, error: customerError } = await userDb.from('customers')
    .select('id,code,name').eq('id', contact.customer_id).maybeSingle();
  if (customerError || !customer || cleanCode(customer.code) !== cleanCode(damage.customer_code)
      || cleanText(customer.name).toLocaleLowerCase('pt-BR') !== cleanText(damage.customer_name).toLocaleLowerCase('pt-BR')) {
    return json({ error: 'CONTACT_NOT_FOUND' }, 404);
  }

  const { data: items, error: itemsError } = await userDb.from('damage_items')
    .select('product_text,quantity,quantity_unit,item_order').eq('request_id', requestId).order('item_order');
  if (itemsError) { console.error('receipt items lookup', itemsError); return json({ error: 'RECEIPT_LOOKUP_FAILED' }, 500); }
  if (!items?.length) return json({ error: 'RECEIPT_NOT_FOUND' }, 404);

  const itemLines = items.map((item) => {
    const qty = quantityText(item.quantity);
    const unit = item.quantity_unit === 'CAIXA' ? (Number(item.quantity) === 1 ? 'caixa' : 'caixas')
      : (Number(item.quantity) === 1 ? 'unidade' : 'unidades');
    return `• ${cleanText(item.product_text)} — ${qty} ${unit}`;
  }).join('\n');
  if (!itemLines || itemLines.length > 700) return json({ error: 'RECEIPT_TOO_LONG' }, 422);
  const variables = [cleanText(damage.customer_name), cleanText(damage.customer_code),
    cleanText(damage.map_number), dateBR(damage.occurrence_date), itemLines];
  if (variables.some((value) => !value)) return json({ error: 'RECEIPT_NOT_FOUND' }, 422);

  const { data: attempt, error: logError } = await adminDb.from('damage_receipt_sends')
    .insert({ request_id: requestId, contact_id: contactId, recipient_phone: contact.phone_normalized,
      requested_by: userData.user.id, status: 'PROCESSING' }).select('id').single();
  if (logError) {
    if (logError.code === '23505') {
      const { data: existing } = await adminDb.from('damage_receipt_sends')
        .select('status,provider_message_id').eq('request_id', requestId).eq('contact_id', contactId)
        .in('status', ['PROCESSING', 'ACCEPTED', 'UNKNOWN']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (existing?.status === 'ACCEPTED') return json({ accepted: true, already_sent: true, message_id: existing.provider_message_id });
      return json({ error: existing?.status === 'UNKNOWN' ? 'SEND_STATUS_UNKNOWN' : 'SEND_IN_PROGRESS' }, 409);
    }
    console.error('receipt send log', logError);
    return json({ error: 'SEND_LOG_FAILED' }, 500);
  }

  let status = 'UNKNOWN';
  let providerMessageId: string | null = null;
  let providerErrorCode: string | null = null;
  try {
    const providerResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual',
        to: contact.phone_normalized, type: 'template', template: { name: templateName,
          language: { code: language }, components: [{ type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) }] } }),
    });
    const provider = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      status = 'REJECTED';
      providerErrorCode = String(provider?.error?.code || providerResponse.status).slice(0, 60);
      console.error('WhatsApp receipt rejected', providerErrorCode);
    } else {
      providerMessageId = String(provider?.messages?.[0]?.id || '');
      if (providerMessageId) status = 'ACCEPTED';
    }
  } catch (error) {
    console.error('WhatsApp receipt response unknown', error);
  }

  const { error: updateError } = await adminDb.from('damage_receipt_sends')
    .update({ status, provider_message_id: providerMessageId, provider_error_code: providerErrorCode,
      updated_at: new Date().toISOString() }).eq('id', attempt.id);
  if (updateError) { console.error('receipt send status update', updateError); return json({ error: 'SEND_STATUS_UNKNOWN' }, 503); }
  if (status === 'ACCEPTED') return json({ accepted: true, already_sent: false, message_id: providerMessageId });
  return json({ error: status === 'REJECTED' ? 'META_SEND_FAILED' : 'SEND_STATUS_UNKNOWN' }, status === 'REJECTED' ? 502 : 503);
});
