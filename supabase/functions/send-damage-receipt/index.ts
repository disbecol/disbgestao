import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as PDFLib from 'https://esm.sh/pdf-lib@1.17.1';
import { createDamageReceiptPdf, loadReceiptCatalogImages, receiptFileName, receiptGreeting, receiptTemplateComponents, receiptSha256, receiptSnapshot } from './receipt-pdf.mjs';

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
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const token = env('WHATSAPP_ACCESS_TOKEN');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = env('WHATSAPP_TEMPLATE_NAME') || 'comprovante_avaria_pdf';
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
  const resend = input?.resend === true;
  const suppliedOperationId = input?.operation_id;
  // Reenviar um aceite pode gerar nova cobrança e exige confirmação explícita.
  // Um UUID estável por confirmação torna seguro repetir uma chamada perdida.
  if (!uuid.test(requestId) || !uuid.test(contactId)
      || (input?.resend !== undefined && typeof input.resend !== 'boolean')
      || (suppliedOperationId !== undefined && (typeof suppliedOperationId !== 'string' || !uuid.test(suppliedOperationId)))
      || (resend && suppliedOperationId === undefined)) return json({ error: 'INVALID_BODY' }, 400);
  const operationId = typeof suppliedOperationId === 'string' ? suppliedOperationId : crypto.randomUUID();

  // RLS e a autoria da avaria limitam o motorista aos próprios comprovantes.
  const { data: damage, error: damageError } = await userDb.from('damage_requests')
    .select('id,created_by,created_at,unit,signature_path,customer_code,customer_name,map_number,occurrence_date')
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
    .select('product_text,quantity,quantity_unit,item_order,status').eq('request_id', requestId).order('item_order');
  if (itemsError) { console.error('receipt items lookup', itemsError); return json({ error: 'RECEIPT_LOOKUP_FAILED' }, 500); }
  if (!items?.length) return json({ error: 'RECEIPT_NOT_FOUND' }, 404);
  const activeItems = items.filter((item) => item.status !== 'CANCELADO');
  if (!activeItems.length) return json({ error: 'RECEIPT_CANCELLED' }, 409);

  if (activeItems.length > 200 || activeItems.some(item => String(item.product_text || '').length > 4000)) {
    return json({ error: 'RECEIPT_TOO_LONG' }, 422);
  }
  if (![damage.customer_name, damage.customer_code, damage.map_number, dateBR(damage.occurrence_date)].every(cleanText)
      || activeItems.some(item => !cleanText(item.product_text) || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0)) {
    return json({ error: 'RECEIPT_NOT_FOUND' }, 422);
  }
  try { receiptGreeting(damage.created_at); } catch { return json({ error: 'RECEIPT_NOT_FOUND' }, 422); }

  // A reserva transacional protege confirmações concorrentes e preserva todos
  // os aceites anteriores. O navegador nunca insere/atualiza esse histórico.
  const { data: attempt, error: logError } = await adminDb.rpc('reserve_damage_receipt_send', {
    p_request_id: requestId, p_contact_id: contactId, p_requested_by: userData.user.id,
    p_operation_id: operationId, p_resend: resend,
  });
  if (logError) {
    const conflict = ['OPERATION_ID_CONFLICT','RESEND_NOT_AVAILABLE'].find(code => String(logError.message || '').includes(code));
    if (conflict) return json({ error: conflict }, 409);
    if (String(logError.message || '').includes('FORBIDDEN')) return json({ error: 'RECEIPT_NOT_FOUND' }, 404);
    console.error('receipt send log', logError);
    return json({ error: 'SEND_LOG_FAILED' }, 500);
  }
  if (!attempt?.id || !['PROCESSING','ACCEPTED','REJECTED','UNKNOWN'].includes(attempt.status)) {
    return json({ error: 'SEND_LOG_FAILED' }, 500);
  }
  if (attempt.reserved !== true) {
    if (attempt.status === 'ACCEPTED') {
      const { data: existingReceipt } = await adminDb.from('damage_receipts')
        .select('receipt_code').eq('send_id', attempt.id).maybeSingle();
      return json({ accepted: true, already_sent: true, message_id: attempt.provider_message_id,
        operation_id: attempt.operation_id, receipt_code: existingReceipt?.receipt_code || null });
    }
    if (attempt.status === 'REJECTED') return json({ error: 'META_SEND_FAILED', operation_id: attempt.operation_id }, 502);
    return json({ error: attempt.status === 'UNKNOWN' ? 'SEND_STATUS_UNKNOWN' : 'SEND_IN_PROGRESS',
      operation_id: attempt.operation_id }, 409);
  }
  if (attempt.status !== 'PROCESSING') return json({ error: 'SEND_LOG_FAILED' }, 500);

  let status = 'UNKNOWN';
  let providerMessageId: string | null = null;
  let providerErrorCode: string | null = null;
  let messageRequestStarted = false;
  let preparationStage = 'PDF_SIGNATURE_FAILED';
  let receiptCode: string | null = null;
  try {
    // Não transmitir para um telefone diferente daquele validado com aceite.
    // Se o contato mudou entre a consulta e a reserva, encerrar esta tentativa
    // como rejeitada e exigir nova leitura/validação do contato.
    preparationStage = 'CONTACT_NOT_FOUND';
    if (attempt.recipient_phone !== contact.phone_normalized) throw new Error('CONTACT_NOT_FOUND');
    preparationStage = 'PDF_SIGNATURE_FAILED';
    // A assinatura é lida da avaria autenticada, nunca de URL ou arquivo do cliente.
    const { data: signatureBlob, error: signatureError } = await userDb.storage.from('avarias').download(damage.signature_path || '');
    if (signatureError || !signatureBlob || signatureBlob.size > 3000000
        || !/^image\/(jpeg|png)(?:;|$)/i.test(signatureBlob.type)) throw new Error('PDF_SIGNATURE_FAILED');
    const signature = new Uint8Array(await signatureBlob.arrayBuffer());
    preparationStage = 'PDF_REGISTRY_FAILED';
    const { data: registry, error: registryError } = await adminDb.from('damage_receipts')
      .insert({ request_id: requestId, send_id: attempt.id, requested_by: userData.user.id, unit: damage.unit,
        snapshot: receiptSnapshot(damage, activeItems, await receiptSha256(signature)) })
      .select('id,receipt_code').single();
    if (registryError || !registry) throw new Error('PDF_REGISTRY_FAILED');
    receiptCode = registry.receipt_code;
    preparationStage = 'PDF_CREATE_FAILED';
    const verification = { code: receiptCode, signature, generatedAt: new Date().toISOString() };
    const catalogImages = await loadReceiptCatalogImages(activeItems, fetch);
    let pdfBytes = await createDamageReceiptPdf(damage, activeItems, PDFLib, catalogImages, verification);
    // As imagens são opcionais. Nunca descartar produtos para caber no arquivo.
    if (pdfBytes.length > 10000000) pdfBytes = await createDamageReceiptPdf(damage, activeItems, PDFLib, new Map(), verification);
    if (pdfBytes.length > 10000000) throw new Error('PDF_TOO_LARGE');
    // Congela a impressão digital do arquivo ANTES de transmitir mídia/mensagem.
    preparationStage = 'PDF_REGISTRY_FAILED';
    const { data: sealed, error: sealError } = await adminDb.from('damage_receipts')
      .update({ pdf_sha256: await receiptSha256(pdfBytes), generated_at: verification.generatedAt })
      .eq('id', registry.id).is('pdf_sha256', null).select('id').single();
    if (sealError || !sealed) throw new Error('PDF_REGISTRY_FAILED');
    const filename = receiptFileName(damage);
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', 'application/pdf');
    form.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    preparationStage = 'MEDIA_UPLOAD_FAILED';
    const mediaResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      signal: AbortSignal.timeout(20000),
    });
    const media = await mediaResponse.json().catch(() => ({}));
    if (!mediaResponse.ok || !/^\d+$/.test(String(media?.id || ''))) {
      preparationStage = `MEDIA_UPLOAD_${String(media?.error?.code || mediaResponse.status).slice(0, 30)}`;
      throw new Error('MEDIA_UPLOAD_FAILED');
    }
    const components = receiptTemplateComponents(damage, String(media.id), filename);
    // Um único modelo com cabeçalho PDF e texto de apresentação. Não envia
    // mensagem de texto avulsa, que dependeria da janela de atendimento.
    messageRequestStarted = true;
    const providerResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual',
        to: contact.phone_normalized, type: 'template', template: { name: templateName,
          language: { code: language }, components } }),
      signal: AbortSignal.timeout(20000),
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
    if (messageRequestStarted) {
      console.error('WhatsApp receipt response unknown');
    } else {
      status = 'REJECTED';
      const failure = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
      providerErrorCode = ['RECEIPT_LAYOUT_TOO_LARGE','RECEIPT_SIGNATURE_MISSING','RECEIPT_SIGNATURE_INVALID'].includes(failure)
        ? failure : preparationStage;
      console.error('WhatsApp receipt preparation failed', preparationStage);
    }
  }

  const { error: updateError } = await adminDb.from('damage_receipt_sends')
    .update({ status, provider_message_id: providerMessageId, provider_error_code: providerErrorCode,
      updated_at: new Date().toISOString() }).eq('id', attempt.id);
  if (updateError) { console.error('receipt send status update', updateError); return json({ error: 'SEND_STATUS_UNKNOWN' }, 503); }
  if (status === 'ACCEPTED') return json({ accepted: true, already_sent: false, message_id: providerMessageId,
    receipt_code: receiptCode, operation_id: operationId, resent: resend });
  const preparationError = ['CONTACT_NOT_FOUND','PDF_SIGNATURE_FAILED','PDF_REGISTRY_FAILED','RECEIPT_LAYOUT_TOO_LARGE','RECEIPT_SIGNATURE_MISSING','RECEIPT_SIGNATURE_INVALID'].includes(String(providerErrorCode));
  return json({ error: status === 'REJECTED' ? (preparationError ? providerErrorCode : 'META_SEND_FAILED') : 'SEND_STATUS_UNKNOWN' }, status === 'REJECTED' ? 502 : 503);
});
