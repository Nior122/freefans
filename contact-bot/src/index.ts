interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Database { prepare(query: string): D1PreparedStatement; }

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_ID: string;
  SERVICE_CHECKOUT_URL?: string;
  SERVICE_PRODUCT_ID?: string;
  PAYMENT_PROVIDER?: string;
  PAYMENT_METHODS?: string;
  SITE_URL?: string;
  SELAR_CHECKOUT_URL?: string;
  SELAR_WEBHOOK_SECRET?: string;
  SELAR_PRODUCT_ID?: string;
  AI?: { run(model: string, input: any): Promise<any> };
  AI_MODEL?: string;
}
type TelegramPhotoSize = { file_id?: string; file_unique_id?: string; file_size?: number; width?: number; height?: number };
type TelegramDocument = { file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number };
type TelegramVoice = { file_id?: string; file_unique_id?: string; file_size?: number; duration?: number; mime_type?: string };
type TelegramAudio = { file_id?: string; file_unique_id?: string; file_size?: number; duration?: number; mime_type?: string; file_name?: string };
type TelegramVideo = { file_id?: string; file_unique_id?: string; file_size?: number; mime_type?: string; duration?: number };
type Msg = {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  video?: TelegramVideo;
};
type Update = { message?: Msg; callback_query?: { id: string; from: { id: number }; message?: Msg; data?: string } };
type Profile = { id: string; name: string };
type OrderKind = "contact" | "service";
type CustomerOrder = {
  kind: OrderKind;
  id: string;
  target_id?: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  telegram_username?: string;
  buyer_email?: string;
  status: string;
  payment_method?: string;
  payment_reference?: string;
  checkout_code?: string;
  checkout_name?: string;
  created_at?: string;
};
type ReceiptMedia = {
  kind: "photo" | "document";
  fileId: string;
  fileUniqueId: string | null;
  mimeType: string | null;
  fileSize: number | null;
};
type ReceiptSubmission = {
  id: string;
  order_id: string;
  status: string;
};
type AdminBroadcastDraft = { id: string; admin_telegram_id: string; message_text?: string | null; media_kind?: "photo" | "document" | null; media_file_id?: string | null; media_mime_type?: string | null; status: string; expires_at: string };
type AdminMessageDraft = {
  id: string;
  order_id: string;
  order_kind: OrderKind;
  admin_telegram_id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  checkout_code?: string | null;
  message_text?: string | null;
  media_kind?: "photo" | "document" | null;
  media_file_id?: string | null;
  media_mime_type?: string | null;
  status: string;
  expires_at: string;
  delivered_at?: string | null;
  created_at?: string;
  updated_at?: string;
};
type RequestRow = { id: string; telegram_chat_id: string; profile_id: string; status: string; buyer_email?: string; manual_payment_reference?: string; checkout_code?: string; checkout_name?: string };
const CODE_CHARS = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function checkoutCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "FL-";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}
async function generateUniqueCheckoutCode(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = checkoutCode();
    const existingContact = await db.prepare("SELECT id FROM contact_requests WHERE checkout_code=?").bind(code).first();
    if (existingContact) continue;
    const existingService = await db.prepare("SELECT id FROM service_orders WHERE checkout_code=?").bind(code).first();
    if (existingService) continue;
    return code;
  }
  throw new Error("checkout_code_generation_exhausted");
}
const normName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const codeInName = (value: string) => (value.match(/\bFL-[A-Z0-9]{6}\b/i)?.[0] || "").toUpperCase();
const headers = { "content-type": "application/json; charset=utf-8" };
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
function safeEq(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
const esc = (s: string) => s.replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
const provider = (e: Env) => (e.PAYMENT_PROVIDER || "selar").trim().toLowerCase();
const methods = (e: Env) => (e.PAYMENT_METHODS || "selar").split(",").map(x => x.trim().toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
function enabledMethods(e: Env) {
  const configured: string[] = [];
  if (methods(e).includes("selar") && provider(e) === "selar" && e.SELAR_CHECKOUT_URL && e.SELAR_PRODUCT_ID) configured.push("selar");
  return configured;
}
async function tg(e: Env, method: string, data: Record<string, unknown>) {
  let r: Response;
  try {
    r = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  } catch {
    // Never surface the request URL (it contains the bot token) in errors or logs.
    throw new Error(`Telegram ${method} request failed`);
  }
  let j: { ok?: boolean; description?: string };
  try { j = await r.json() as { ok?: boolean; description?: string }; } catch { throw new Error(`Telegram ${method} returned an invalid response`); }
  if (!r.ok || !j.ok) throw new Error(`Telegram ${method} failed: ${j.description || r.status}`);
  return j;
}
async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: boolean; value?: unknown; status?: number; error?: string }> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
  let text: string;
  try { text = await request.text(); } catch { return { ok: false, status: 400, error: "invalid_body" }; }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, status: 400, error: "invalid_json" }; }
}
async function say(e: Env, chat: string | number, text: string, markup?: unknown) {
  return tg(e, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
}
async function notifyAdminIfConfigured(e: Env, text: string) {
  if (!e.ADMIN_TELEGRAM_ID) return;
  await say(e, e.ADMIN_TELEGRAM_ID, text);
}
async function telegramFileBytes(e: Env, fileId: string, maxBytes = 10 * 1024 * 1024): Promise<Uint8Array> {
  const metaResponse = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!metaResponse.ok) throw new Error("Telegram file lookup failed");
  const meta = await metaResponse.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  if (!meta.ok || !meta.result?.file_path) throw new Error("Telegram file metadata unavailable");
  if (meta.result.file_size && meta.result.file_size > maxBytes) throw new Error("Media exceeds the supported size limit");
  const response = await fetch(`https://api.telegram.org/file/bot${e.TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`);
  if (!response.ok) throw new Error("Telegram file download failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("Media exceeds the supported size limit");
  return bytes;
}
async function sendVoiceReply(e: Env, chat: string | number, text: string) {
  if (!e.AI || !text.trim()) return false;
  try {
    const result = await e.AI.run("@cf/myshell-ai/melotts", { prompt: text.slice(0, 700), lang: "en" });
    let bytes: Uint8Array | null = null;
    if (result instanceof ArrayBuffer) bytes = new Uint8Array(result);
    else if (result instanceof Uint8Array) bytes = result;
    else if (result?.audio instanceof ArrayBuffer) bytes = new Uint8Array(result.audio);
    else if (Array.isArray(result?.audio)) bytes = new Uint8Array(result.audio);
    else if (typeof result?.audio === "string") {
      const raw = atob(result.audio);
      bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    }
    if (!bytes?.byteLength) return false;
    const form = new FormData();
    form.set("chat_id", String(chat));
    form.set("voice", new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: "audio/mpeg" }), "reply.mp3");
    const response = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
    const body = await response.json() as { ok?: boolean };
    return response.ok && body.ok === true;
  } catch (error) {
    console.error("Voice reply unavailable", String(error));
    return false;
  }
}
async function transcribeVoice(e: Env, m: Msg): Promise<string> {
  if (!e.AI) throw new Error("Speech recognition is unavailable");
  const media = m.voice || m.audio;
  if (!media?.file_id) throw new Error("Voice message has no Telegram file ID");
  if ((media.file_size || 0) > 10 * 1024 * 1024) throw new Error("Voice messages must be under 10 MB");
  const bytes = await telegramFileBytes(e, media.file_id);
  const result = await e.AI.run("@cf/openai/whisper", { audio: Array.from(bytes) });
  const transcript = String(result?.text || result?.transcription || "").trim();
  if (!transcript) throw new Error("Speech could not be transcribed");
  return transcript.slice(0, 3500);
}
async function analysePhoto(e: Env, m: Msg, prompt: string): Promise<string> {
  if (!e.AI) throw new Error("Image analysis is unavailable");
  const photos = Array.isArray(m.photo) ? m.photo : [];
  const photo = photos[photos.length - 1];
  if (!photo?.file_id) throw new Error("Image has no Telegram file ID");
  const bytes = await telegramFileBytes(e, photo.file_id, 8 * 1024 * 1024);
  // LLaVA's Workers AI endpoint expects the actual image bytes plus a description prompt.
  // This model was smoke-tested against the account API and returned a non-empty description.
  const result = await e.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
    image: Array.from(bytes),
    description: (prompt || "Describe this image and answer any question the user included. Be concise and helpful.").slice(0, 1000)
  });
  const answer = String(result?.answer || result?.response || result?.description || result?.result || "").trim();
  if (!answer) throw new Error("Image model returned no answer");
  return answer.slice(0, 3500);
}
async function sayBestEffort(e: Env, chat: string | number, text: string) {
  // Informational customer notifications must never roll back a recorded payment
  // or strand an admin action (e.g. the customer blocked the bot). Actual delivery
  // of creator contact details and service fulfilment deliberately do NOT use this.
  try { await say(e, chat, text); } catch { /* best effort */ }
}
async function catalogue(e: Env): Promise<Profile[]> {
  const r = await fetch(`${(e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "")}/contact-catalogue.json`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error("profile catalogue unavailable");
  const j = await r.json() as { profiles?: Profile[] };
  if (!Array.isArray(j.profiles)) throw new Error("invalid catalogue");
  const hidden = await e.DB.prepare("SELECT profile_id FROM hidden_profiles").all<any>();
  const hiddenIds = new Set((hidden.results || []).map((row:any) => String(row.profile_id)));
  // Defence in depth: only the two public fields are ever carried into bot logic,
  // even if a future catalogue regression added restricted fields.
  return j.profiles
    .filter(p => p && typeof p.id === "string" && /^[A-Za-z0-9._-]{1,50}$/.test(p.id) && typeof p.name === "string" && p.name.trim().length > 0)
    .filter(p => !hiddenIds.has(p.id))
    .map(p => ({ id: p.id, name: p.name.slice(0, 120) }));
}
function paymentKeyboard(e: Env, id: string) {
  const rows: Record<string, unknown>[][] = [];
  if (enabledMethods(e).includes("selar")) rows.push([{ text: "💳 Pay with Selar", callback_data: `pay_selar:${id}` }]);
  rows.push([{ text: "🔎 I've paid — check again", callback_data: `paid:${id}` }]);
  return { inline_keyboard: rows };
}

async function loadCustomerOrderByKind(e: Env, kind: OrderKind, id: string): Promise<CustomerOrder | null> {
  if (kind === "contact") {
    const contact = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,profile_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM contact_requests WHERE id=?").bind(id).first<any>();
    return contact ? { kind: "contact", ...contact } : null;
  }
  const service = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,service_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM service_orders WHERE id=?").bind(id).first<any>();
  return service ? { kind: "service", ...service } : null;
}

async function loadCustomerOrderById(e: Env, id: string): Promise<CustomerOrder | null> {
  return (await loadCustomerOrderByKind(e, "contact", id)) || loadCustomerOrderByKind(e, "service", id);
}

async function findCustomerOrderForPaidClaim(e: Env, user: string): Promise<CustomerOrder | null> {
  const contact = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,profile_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM contact_requests WHERE telegram_user_id=? AND status IN('pending_payment','payment_verified','approved') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  const service = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,service_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','pending_payment','payment_verified','fulfilled') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  const candidates: CustomerOrder[] = [];
  if (contact) candidates.push({ kind: "contact", ...contact });
  if (service) candidates.push({ kind: "service", ...service });
  const rank = (order: CustomerOrder) => order.status === "pending_payment" ? 0 : order.status === "payment_verified" ? 1 : order.status === "awaiting_request" ? 2 : 3;
  candidates.sort((a, b) => rank(a) - rank(b) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return candidates[0] || null;
}

async function attachedSaleReference(e: Env, order: CustomerOrder): Promise<string> {
  if (order.payment_reference) return String(order.payment_reference);
  const sale = await e.DB.prepare("SELECT provider_reference FROM processed_sales WHERE request_id=? ORDER BY received_at DESC LIMIT 1").bind(order.id).first<any>();
  return sale?.provider_reference ? String(sale.provider_reference) : "";
}

async function clearPaymentPrompts(e: Env, user: string, orderId: string) {
  await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, orderId).run();
  await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, orderId).run();
}

async function forwardedReceiptForOrder(e: Env, orderId: string): Promise<ReceiptSubmission | null> {
  return e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE order_id=? AND status='forwarded' ORDER BY created_at ASC LIMIT 1").bind(orderId).first<ReceiptSubmission>();
}

function isPaidClaimText(text: string): boolean {
  const withoutCode = text.replace(/\bFL-[A-Z0-9]{6}\b/i, "").trim().replace(/\s+/g, " ");
  // Natural follow-ups such as "I paid, please check again" trigger a fresh
  // database reconciliation check rather than falling through to generic chat.
  return /^\/?(?:paid|done|i(?:\s+have|\s+already)?\s+paid|i['’]ve\s+paid|already\s+paid|payment\s+(?:is\s+)?(?:done|made|completed|complete|successful|sent)|checkout\s+(?:is\s+)?(?:done|completed|complete)|done\s+paying)(?:[.!?\s,;:-]+(?:please\s+)?(?:check(?:\s+again)?|recheck|verify|look\s+again|my\s+payment|the\s+payment|for\s+my\s+sale|again))*[.!?]*$/i.test(withoutCode)
    || /\b(?:i\s+(?:have\s+|already\s+)?paid|i['’]?ve paid|payment (?:is )?(?:done|completed|successful))\b.*\b(?:check|recheck|again|verify|payment|sale)\b/i.test(withoutCode);
}

async function promptForReceiptReview(e: Env, chat: string, user: string, order: CustomerOrder, prefix = ""): Promise<string> {
  if (!e.ADMIN_TELEGRAM_ID) {
    await say(e, chat, `${prefix}I still can't find a matching Selar sale record for this order, and receipt review is not configured yet. Your order remains pending; please contact support rather than sending credentials or bank details here.`);
    return "admin_unavailable";
  }
  const forwarded = await forwardedReceiptForOrder(e, order.id);
  if (forwarded) {
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, order.id).run();
    await say(e, chat, `${prefix}Your Selar receipt has already been forwarded to the administrator for manual review. You do not need to send it again. Your ${order.kind === "contact" ? "request" : "order"} remains pending until the administrator checks Selar and verifies the payment manually.`);
    return "receipt_already_forwarded";
  }
  await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
  await say(e, chat, `${prefix}I checked the existing payment records and still can't find a matching Selar sale attached to order code <code>${esc(order.checkout_code || "")}</code>.\n\nPlease forward your <b>Selar receipt</b> here as a Telegram photo or as a PDF/JPG/PNG/WebP document. I will send it to the administrator with this order's details for manual review.\n\nThe receipt is evidence only: it will <b>not</b> mark your order paid, verified, approved, or fulfilled. Never send bank logins, card PINs, passwords, or one-time codes.`);
  return "receipt_needed";
}

async function handlePaidClaim(e: Env, chat: string, user: string, order: CustomerOrder | null, options: { nameJustRecorded?: boolean } = {}): Promise<string> {
  const prefix = options.nameJustRecorded ? "Thanks — your checkout name has been recorded. " : "";
  if (!order || String(order.telegram_user_id) !== user) {
    await say(e, chat, "I can't find a current FansLeak contact request or service order for this Telegram account. Start from the profile or service page first; a payment receipt cannot be attached to an order that the bot cannot identify.");
    return "no_order";
  }
  if (order.status === "payment_verified") {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, `${prefix}Your payment has already been checked and manually verified by the administrator. ${order.kind === "contact" ? "Your request is now waiting for final approval and recorded creator consent; no receipt is needed." : "Your service order is now awaiting fulfilment; no receipt is needed."}`);
    return "verified";
  }
  if (order.status === "approved" || order.status === "fulfilled") {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, `${prefix}This ${order.kind === "contact" ? "request" : "order"} has already been ${order.status}. No receipt is needed.`);
    return "completed";
  }
  if (order.status === "awaiting_request") {
    await say(e, chat, "This service order has not reached the payment step yet. Finish describing what you need, then type PAY and complete the Selar checkout before sending a receipt.");
    return "awaiting_request";
  }
  if (order.status !== "pending_payment") {
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, order.id).run();
    await say(e, chat, `This ${order.kind === "contact" ? "request" : "order"} is no longer waiting for payment, so I can't accept a receipt for it. Please contact support if you believe this is a mistake.`);
    return "closed";
  }

  // Always check the existing backend evidence before asking for a receipt.
  // A webhook/manual sale already has an admin verification path, so a receipt
  // would only duplicate that process.
  const saleReference = await attachedSaleReference(e, order);
  if (saleReference) {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, `${prefix}I found a Selar sale record already attached to this ${order.kind === "contact" ? "request" : "order"}. It is in the existing manual-verification queue, so you do <b>not</b> need to send a receipt. The administrator still has to check Selar and verify the payment manually; nothing has been approved or fulfilled automatically.`);
    return "sale_found";
  }

  if (!String(order.checkout_name || "").trim()) {
    await e.DB.prepare("INSERT OR REPLACE INTO checkout_name_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
    await say(e, chat, `I checked the existing payment records and can't find a matching Selar sale yet. First, please send the exact full name you used in Selar's name field, including the code. Example: <code>Joseph Unaogu ${esc(order.checkout_code || "FL-7K4P9A")}</code>. This does not confirm payment; it only helps the administrator match the sale to the correct ${order.kind === "contact" ? "request" : "order"}.`);
    return "name_needed";
  }
  return promptForReceiptReview(e, chat, user, order, prefix);
}

function receiptFileSize(value: unknown): number | null {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? Math.trunc(size) : null;
}

function extractSupportMedia(m: Msg): { media?: ReceiptMedia; unsupported?: string } {
  if (m.video) {
    const video = m.video;
    if (typeof video.file_id !== "string" || !video.file_id || video.file_id.length > 512) return { unsupported: "That video did not include a usable Telegram file reference. Please send it again." };
    const fileSize = receiptFileSize(video.file_size);
    if (fileSize !== null && fileSize > 20_000_000) return { unsupported: "Videos must be 20 MB or smaller to attach to a support message." };
    return { media: { kind: "document", fileId: video.file_id, fileUniqueId: typeof video.file_unique_id === "string" ? video.file_unique_id.slice(0, 512) : null, mimeType: (video.mime_type || "video/mp4").toLowerCase().split(";", 1)[0].trim().slice(0, 100), fileSize } };
  }
  return extractReceiptMedia(m);
}

function extractReceiptMedia(m: Msg): { media?: ReceiptMedia; unsupported?: string } {
  const maxBytes = 20_000_000;
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const candidates = m.photo.filter(p => typeof p?.file_id === "string" && p.file_id.length > 0 && p.file_id.length <= 512);
    if (candidates.length === 0) return { unsupported: "That photo did not include a usable Telegram file reference. Please send the receipt again as a photo or PDF/image document." };
    const photo = candidates.reduce((best, current) => {
      const bestScore = Number(best.file_size || 0) || Number(best.width || 0) * Number(best.height || 0);
      const currentScore = Number(current.file_size || 0) || Number(current.width || 0) * Number(current.height || 0);
      return currentScore > bestScore ? current : best;
    });
    const fileSize = receiptFileSize(photo.file_size);
    if (fileSize !== null && fileSize > maxBytes) return { unsupported: "That receipt photo is too large for the bot to forward safely. Please send a smaller photo or PDF/image document." };
    return { media: { kind: "photo", fileId: String(photo.file_id), fileUniqueId: typeof photo.file_unique_id === "string" ? photo.file_unique_id.slice(0, 512) : null, mimeType: "image/jpeg", fileSize } };
  }

  if (m.document) {
    const doc = m.document;
    if (typeof doc.file_id !== "string" || !doc.file_id || doc.file_id.length > 512) return { unsupported: "That document did not include a usable Telegram file reference. Please send the Selar receipt again as a photo or PDF/image document." };
    const fileSize = receiptFileSize(doc.file_size);
    if (fileSize !== null && fileSize > maxBytes) return { unsupported: "That receipt document is too large for the bot to forward safely. Please send a smaller PDF/image document or a photo." };
    const mimeType = typeof doc.mime_type === "string" ? doc.mime_type.toLowerCase().split(";", 1)[0].trim().slice(0, 100) : "";
    const extension = (typeof doc.file_name === "string" ? doc.file_name.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] : "") || "";
    const allowedMime = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    const allowedExtension = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);
    const genericMime = !mimeType || mimeType === "application/octet-stream";
    if (!allowedMime.has(mimeType) && !(genericMime && allowedExtension.has(extension))) {
      return { unsupported: "I can forward a Selar receipt only as a Telegram photo or a PDF, JPG, PNG, or WebP document. Please send one of those formats; do not send archives or other files." };
    }
    const inferredMime = mimeType || (extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg");
    return { media: { kind: "document", fileId: doc.file_id, fileUniqueId: typeof doc.file_unique_id === "string" ? doc.file_unique_id.slice(0, 512) : null, mimeType: inferredMime, fileSize } };
  }
  return {};
}

const ADMIN_MESSAGE_TEXT_LIMIT = 2500;
const ADMIN_MESSAGE_CAPTION_LIMIT = 1024;
const ADMIN_MESSAGE_HEADER = "💬 <b>Message from FansLeak support</b>";

function draftExpiryMs(value: unknown): number {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const iso = /Z$/i.test(raw) ? raw : raw.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

function isDraftExpired(expiresAt: unknown): boolean {
  const expiry = draftExpiryMs(expiresAt);
  return !Number.isFinite(expiry) || expiry <= Date.now();
}

function adminMessageCaption(body: string): string {
  return ADMIN_MESSAGE_HEADER + "\n\n" + esc(body);
}

function adminMessageKeyboard(draftId: string) {
  return {
    inline_keyboard: [
      [{ text: "👀 Preview", callback_data: "support-message:preview:" + draftId }],
      [
        { text: "✅ Send to customer", callback_data: "support-message:send:" + draftId },
        { text: "✖️ Cancel", callback_data: "support-message:cancel:" + draftId }
      ]
    ]
  };
}

function adminMessageBody(draft: AdminMessageDraft): string {
  return String(draft.message_text || "").trim();
}

function adminMessageContentDetails(draft: AdminMessageDraft): string {
  const body = adminMessageBody(draft);
  return "media=" + (draft.media_file_id ? String(draft.media_kind || "file") : "none") + "; text_length=" + body.length;
}

function adminMessageSendProblem(draft: AdminMessageDraft): string {
  const body = adminMessageBody(draft);
  if (!body && !draft.media_file_id) return "Add a message or attach one photo/document before sending.";
  if (body.length > ADMIN_MESSAGE_TEXT_LIMIT) return "Support message text is too long. Shorten it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer.";
  if (draft.media_file_id && draft.media_kind !== "photo" && draft.media_kind !== "document") return "The attached media type is not supported. Nothing was sent.";
  if (draft.media_file_id && body && adminMessageCaption(body).length > ADMIN_MESSAGE_CAPTION_LIMIT) {
    return "The text is too long to use as a Telegram media caption (" + adminMessageCaption(body).length + "/" + ADMIN_MESSAGE_CAPTION_LIMIT + "). Shorten the text, then preview again.";
  }
  return "";
}

async function resolveCustomerOrderReference(e: Env, rawRef: string): Promise<{ order?: CustomerOrder; error?: "invalid" | "missing" | "ambiguous" }> {
  const ref = String(rawRef || "").trim();
  const isCheckoutCode = /^FL-[A-Z0-9]{6}$/i.test(ref);
  const isOrderUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  if (!isCheckoutCode && !isOrderUuid) return { error: "invalid" };

  const field = isCheckoutCode ? "checkout_code" : "id";
  const value = isCheckoutCode ? ref.toUpperCase() : ref.toLowerCase();
  const contactRows = await e.DB.prepare(`SELECT id,telegram_user_id,telegram_chat_id,telegram_username,profile_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM contact_requests WHERE ${field}=? ORDER BY created_at DESC LIMIT 2`).bind(value).all<any>();
  const serviceRows = await e.DB.prepare(`SELECT id,telegram_user_id,telegram_chat_id,telegram_username,service_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM service_orders WHERE ${field}=? ORDER BY created_at DESC LIMIT 2`).bind(value).all<any>();
  const candidates: CustomerOrder[] = [
    ...(contactRows.results || []).map(row => ({ kind: "contact" as const, ...row })),
    ...(serviceRows.results || []).map(row => ({ kind: "service" as const, ...row }))
  ];
  if (candidates.length === 0) return { error: "missing" };
  if (candidates.length > 1) return { error: "ambiguous" };
  return { order: candidates[0] };
}

async function loadAdminMessageDraft(e: Env, draftId: string): Promise<AdminMessageDraft | null> {
  return e.DB.prepare("SELECT id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM admin_message_drafts WHERE id=?").bind(draftId).first<AdminMessageDraft>();
}

async function loadAdminMessageDraftContext(e: Env, draftId: string): Promise<{ draft: AdminMessageDraft; order: CustomerOrder | null } | null> {
  const draft = await loadAdminMessageDraft(e, draftId);
  if (!draft) return null;
  const order = await loadCustomerOrderByKind(e, draft.order_kind, draft.order_id);
  return { draft, order };
}

async function expireAdminMessageDraftIfNeeded(e: Env, draft: AdminMessageDraft): Promise<boolean> {
  if (draft.status !== "draft" || !isDraftExpired(draft.expires_at)) return false;
  await e.DB.prepare("UPDATE admin_message_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
  return true;
}

async function activeBroadcastDraft(e: Env, adminTelegramId: string): Promise<AdminBroadcastDraft | null> {
  return e.DB.prepare("SELECT id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at FROM admin_broadcast_drafts WHERE admin_telegram_id=? AND status IN ('draft','sending') ORDER BY created_at DESC LIMIT 1").bind(adminTelegramId).first<AdminBroadcastDraft>();
}
async function activeAdminMessageDraft(e: Env, adminTelegramId: string): Promise<AdminMessageDraft | null> {
  const draft = await e.DB.prepare("SELECT id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM admin_message_drafts WHERE admin_telegram_id=? AND status='draft' ORDER BY updated_at DESC LIMIT 1").bind(adminTelegramId).first<AdminMessageDraft>();
  if (!draft) return null;
  return (await expireAdminMessageDraftIfNeeded(e, draft)) ? null : draft;
}

async function activeDeliveryDraft(e: Env, adminTelegramId: string): Promise<any | null> {
  const draft = await e.DB.prepare("SELECT id,request_id,checkout_code,status,expires_at FROM delivery_drafts WHERE admin_telegram_id=? AND status='draft' ORDER BY updated_at DESC LIMIT 1").bind(adminTelegramId).first<any>();
  if (!draft) return null;
  if (isDraftExpired(draft.expires_at)) {
    await e.DB.prepare("UPDATE delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    return null;
  }
  return draft;
}

async function auditAdminMessageDraft(e: Env, adminTelegramId: string, action: string, draft: AdminMessageDraft, order: CustomerOrder | null, details: string) {
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)")
    .bind(adminTelegramId, action, draft.order_id, order?.kind === "contact" ? (order.target_id || null) : null, details)
    .run();
}

function adminMessageDraftSummary(draft: AdminMessageDraft, order: CustomerOrder, heading = "💬 <b>Customer support draft</b>"): string {
  const body = adminMessageBody(draft);
  const problem = adminMessageSendProblem(draft);
  const mediaLabel = draft.media_file_id
    ? "One " + esc(String(draft.media_kind || "file")) + " attached" + (draft.media_mime_type ? " (" + esc(String(draft.media_mime_type)) + ")" : "")
    : "None";
  const messageSection = body
    ? esc(body)
    : draft.media_file_id
      ? "<i>Media only — no message text.</i>"
      : "<i>No text or attachment yet. Send text and/or one photo/document in this private chat.</i>";
  const lines = [
    heading,
    "Order type: <b>" + (order.kind === "contact" ? "Contact request" : "Service order") + "</b>",
    "Order code: <code>" + esc(String(order.checkout_code || draft.checkout_code || "not recorded")) + "</code>",
    "Order UUID: <code>" + esc(order.id) + "</code>",
    (order.kind === "contact" ? "Creator profile: " : "Service: ") + "<code>" + esc(String(order.target_id || "unknown")) + "</code>",
    "Current order status: <b>" + esc(order.status) + "</b>",
    "Attachment: " + mediaLabel,
    "",
    "<b>Customer message</b>",
    messageSection
  ];
  if (problem && (body || draft.media_file_id)) lines.push("", "⚠️ " + esc(problem));
  lines.push("", "<i>Preview only — nothing has been sent. Draft expires at " + esc(String(draft.expires_at || "unknown")) + " UTC. Sending this support message will not change payment, approval, consent, delivery, or fulfilment status.</i>");
  return lines.join("\n");
}

async function sendAdminMessageDraftSummary(
  e: Env,
  chat: string | number,
  draft: AdminMessageDraft,
  order: CustomerOrder,
  options: { heading?: string; includeMediaPreview?: boolean; note?: string } = {}
) {
  if (options.includeMediaPreview && draft.media_file_id && (draft.media_kind === "photo" || draft.media_kind === "document")) {
    try {
      const previewCaption = "👀 Attachment preview for order " + String(order.checkout_code || order.id) + "\nPreview only — nothing has been sent to the customer.";
      if (draft.media_kind === "photo") {
        await tg(e, "sendPhoto", { chat_id: chat, photo: draft.media_file_id, caption: previewCaption });
      } else {
        await tg(e, "sendDocument", { chat_id: chat, document: draft.media_file_id, caption: previewCaption });
      }
    } catch {
      await say(e, chat, "⚠️ Telegram could not preview the attachment. The draft remains unsent; check the attachment before using Send.");
    }
  }
  const summary = adminMessageDraftSummary(draft, order, options.heading) + (options.note ? "\n\n" + esc(options.note) : "");
  return say(e, chat, summary, adminMessageKeyboard(draft.id));
}

async function createOrReopenAdminMessageDraft(e: Env, m: Msg, rawRef: string, initialBody: string, media?: ReceiptMedia) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (user !== e.ADMIN_TELEGRAM_ID) return say(e, chat, "Admin access only. Nothing was sent.");
  if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to compose a customer support message. Nothing was sent.");

  const body = String(initialBody || "").trim();
  if (body.length > ADMIN_MESSAGE_TEXT_LIMIT) return say(e, chat, "Support message text is too long. Keep it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer. Nothing was sent.");

  const deliveryDraft = await activeDeliveryDraft(e, user);
  if (deliveryDraft) {
    return say(e, chat, "Finish or cancel the creator-contact delivery draft for <code>" + esc(String(deliveryDraft.checkout_code || "the selected request")) + "</code> before composing a general support message. This prevents text or media being captured by the wrong workflow.");
  }

  const resolved = await resolveCustomerOrderReference(e, rawRef);
  if (resolved.error === "invalid") return say(e, chat, "Use a full order UUID or an order code in the format <code>FL-ABC123</code>. Nothing was sent.");
  if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order, so no draft was opened. Use the exact full order UUID after checking the records.");
  if (resolved.error === "missing" || !resolved.order) return say(e, chat, "No contact request or service order matched that UUID or FL- order code. Nothing was sent.");
  const order = resolved.order;

  const uncertain = await e.DB.prepare("SELECT id FROM admin_message_drafts WHERE order_kind=? AND order_id=? AND status='sending' ORDER BY updated_at DESC LIMIT 1").bind(order.kind, order.id).first<any>();
  if (uncertain) {
    return say(e, chat, "A previous support message for this order has an uncertain Telegram outcome and is locked to prevent a duplicate. Inspect the customer conversation and audit before composing another message for this order.");
  }

  const existing = await activeAdminMessageDraft(e, user);
  if (existing && (existing.order_kind !== order.kind || existing.order_id !== order.id)) {
    return say(e, chat, "Finish or cancel the current customer support draft for <code>" + esc(String(existing.checkout_code || existing.order_id)) + "</code> before composing a message for another order.", adminMessageKeyboard(existing.id));
  }
  if (existing) {
    if (String(existing.telegram_user_id) !== String(order.telegram_user_id) || String(existing.telegram_chat_id) !== String(order.telegram_chat_id)) {
      return say(e, chat, "The customer destination saved on the existing support draft no longer matches this order. Cancel that draft and inspect the order before composing again.", adminMessageKeyboard(existing.id));
    }
    const updated = await e.DB.prepare("UPDATE admin_message_drafts SET checkout_code=?,message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,expires_at=datetime('now','+30 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?")
      .bind(order.checkout_code || null, body || existing.message_text || null, media?.kind || existing.media_kind || null, media?.fileId || existing.media_file_id || null, media?.mimeType || existing.media_mime_type || null, existing.id, user)
      .run();
    if (!updated.meta?.changes) return say(e, chat, "The support draft changed while it was being reopened. Nothing was sent.");
    const context = await loadAdminMessageDraftContext(e, existing.id);
    if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
    return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: "💬 <b>Customer support draft updated</b>" });
  }

  const draftId = crypto.randomUUID();
  try {
    await e.DB.prepare("INSERT INTO admin_message_drafts(id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,media_kind,media_file_id,media_mime_type,status,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',datetime('now','+30 minutes'))")
      .bind(draftId, order.id, order.kind, user, order.telegram_user_id, order.telegram_chat_id, order.checkout_code || null, body || null, media?.kind || null, media?.fileId || null, media?.mimeType || null)
      .run();
  } catch {
    const raced = await activeAdminMessageDraft(e, user);
    if (raced) return say(e, chat, "Another customer support draft was opened at the same time. Finish or cancel it before composing a different support message.", adminMessageKeyboard(raced.id));
    throw new Error("admin_message_draft_create_failed");
  }

  const context = await loadAdminMessageDraftContext(e, draftId);
  if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
  await auditAdminMessageDraft(e, user, "admin_support_draft_created", context.draft, context.order, "Admin created customer support draft for " + order.kind + " order " + String(order.checkout_code || order.id) + "; " + adminMessageContentDetails(context.draft));
  return sendAdminMessageDraftSummary(e, chat, context.draft, context.order);
}

function receiptContextValue(value: unknown, fallback: string, maxLength: number): string {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || fallback;
}

function receiptAdminCaption(order: CustomerOrder, submissionId: string): string {
  const verifyCommand = order.kind === "contact"
    ? `/verify ${order.id} EXACT_SELAR_REFERENCE`
    : `/verifyservice ${order.id} EXACT_SELAR_REFERENCE`;
  const username = receiptContextValue(order.telegram_username, "", 64).replace(/^@+/, "");
  const caption = [
    "<b>Selar receipt submitted for manual review</b>",
    `Submission: <code>${esc(submissionId)}</code>`,
    `Type: ${order.kind === "contact" ? "Contact request" : "Service order"}`,
    `Order: <code>${esc(order.id)}</code>`,
    `${order.kind === "contact" ? "Profile" : "Service"}: <code>${esc(receiptContextValue(order.target_id, "unknown", 100))}</code>`,
    `Checkout code: <code>${esc(receiptContextValue(order.checkout_code, "not recorded", 32))}</code>`,
    `Checkout name: ${esc(receiptContextValue(order.checkout_name, "not recorded", 120))}`,
    `Saved buyer email clue: ${esc(receiptContextValue(order.buyer_email, "not recorded", 160))}`,
    `Telegram user: <code>${esc(order.telegram_user_id)}</code>${username ? ` (@${esc(username)})` : ""}`,
    "",
    "No matching backend sale was attached when this fallback was used. The receipt is customer-supplied evidence only and has NOT changed the order status.",
    "Check the payment in Selar. Only if it is genuinely paid, use:",
    `<code>${esc(verifyCommand)}</code>`
  ].join("\n");
  if (caption.length <= 1024) return caption;

  // HTML escaping can expand customer-provided clues. Telegram media captions
  // are limited to 1024 characters, so retain the identifiers and command the
  // administrator needs and omit the longer reconciliation clues.
  return [
    "<b>Selar receipt submitted for manual review</b>",
    `Submission: <code>${esc(submissionId)}</code>`,
    `Order: <code>${esc(order.id)}</code>`,
    `Checkout code: <code>${esc(receiptContextValue(order.checkout_code, "not recorded", 32))}</code>`,
    `Telegram user: <code>${esc(order.telegram_user_id)}</code>`,
    "Receipt evidence only; order status unchanged. Check Selar, then only if genuinely paid use:",
    `<code>${esc(verifyCommand)}</code>`
  ].join("\n");
}

async function findDuplicateReceiptSubmission(e: Env, user: string, order: CustomerOrder, messageId: number | null, media: ReceiptMedia): Promise<ReceiptSubmission | null> {
  if (messageId !== null) {
    const byMessage = await e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE telegram_user_id=? AND telegram_message_id=? LIMIT 1").bind(user, messageId).first<ReceiptSubmission>();
    if (byMessage) return byMessage;
  }
  if (media.fileUniqueId) {
    return e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE order_id=? AND telegram_file_unique_id=? LIMIT 1").bind(order.id, media.fileUniqueId).first<ReceiptSubmission>();
  }
  return null;
}

async function handleReceiptMedia(e: Env, m: Msg, preliminaryOrder: CustomerOrder) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (chat !== user) return say(e, chat, "For privacy, please send payment receipts only in your private chat with this bot.");
  const order = await loadCustomerOrderById(e, preliminaryOrder.id) || preliminaryOrder;
  if (String(order.telegram_user_id) !== user) return say(e, chat, "I can't attach that receipt to an order belonging to another Telegram account.");
  if (order.status !== "pending_payment") return handlePaidClaim(e, chat, user, order);
  if (!String(order.checkout_name || "").trim()) return handlePaidClaim(e, chat, user, order);

  // Re-check immediately before accepting the receipt: the existing Selar Zap
  // may have attached a sale after the customer was prompted.
  if (await attachedSaleReference(e, order)) return handlePaidClaim(e, chat, user, order);
  if (!e.ADMIN_TELEGRAM_ID) {
    return say(e, chat, "Receipt review is not configured yet, so I can't forward that receipt. Your order remains pending; please contact support rather than sending credentials or bank details here.");
  }

  const extracted = extractReceiptMedia(m);
  if (!extracted.media) {
    await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
    return say(e, chat, extracted.unsupported || "Please send your Selar receipt as a Telegram photo or as a PDF/JPG/PNG/WebP document.");
  }
  const media = extracted.media;
  const forwarded = await forwardedReceiptForOrder(e, order.id);
  if (forwarded) {
    await clearPaymentPrompts(e, user, order.id);
    return say(e, chat, "Your receipt has already been forwarded to the administrator for manual review. You do not need to send it again. Your order remains pending until the administrator checks Selar and verifies the payment manually.");
  }

  // A forwarding row left behind by a process interruption can be retried after
  // a short interval; a fresh one means a duplicate update is already in flight.
  await e.DB.prepare("UPDATE payment_receipt_submissions SET status='superseded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE order_id=? AND status='forwarding' AND updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes')").bind(order.id).run();
  const messageId = Number.isSafeInteger(m.message_id) && Number(m.message_id) > 0 ? Number(m.message_id) : null;
  let submission = await findDuplicateReceiptSubmission(e, user, order, messageId, media);
  let submissionId = "";
  if (!submission) {
    const inFlight = await e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE order_id=? AND status='forwarding' LIMIT 1").bind(order.id).first<ReceiptSubmission>();
    if (inFlight) return say(e, chat, "Your receipt is already being forwarded. Please wait a moment rather than sending it again.");
    submissionId = crypto.randomUUID();
    try {
      await e.DB.prepare("INSERT INTO payment_receipt_submissions(id,order_id,order_kind,telegram_user_id,telegram_chat_id,telegram_message_id,media_kind,telegram_file_id,telegram_file_unique_id,mime_type,file_size,status,admin_telegram_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'forwarding',?)")
        .bind(submissionId, order.id, order.kind, user, chat, messageId, media.kind, media.fileId, media.fileUniqueId, media.mimeType, media.fileSize, e.ADMIN_TELEGRAM_ID).run();
    } catch (err) {
      if (!/unique|constraint/i.test(err instanceof Error ? err.message : String(err))) throw err;
      submission = await findDuplicateReceiptSubmission(e, user, order, messageId, media);
      if (!submission) throw err;
    }
  }
  if (submission) {
    if (submission.status === "forwarded") {
      await clearPaymentPrompts(e, user, order.id);
      return say(e, chat, "That receipt has already been forwarded to the administrator for manual review. You do not need to send it again.");
    }
    if (submission.status === "forwarding") return say(e, chat, "That receipt is already being forwarded. Please wait a moment rather than sending it again.");
    const claimed = await e.DB.prepare("UPDATE payment_receipt_submissions SET status='forwarding',admin_telegram_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('delivery_failed','superseded')").bind(e.ADMIN_TELEGRAM_ID, submission.id).run();
    if (!claimed.meta?.changes) {
      const latestSubmission = await e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE id=?").bind(submission.id).first<ReceiptSubmission>();
      if (latestSubmission?.status === "forwarded") {
        await clearPaymentPrompts(e, user, order.id);
        return say(e, chat, "That receipt has already been forwarded to the administrator for manual review. You do not need to send it again.");
      }
      return say(e, chat, "That receipt is already being processed. Please wait a moment before trying again.");
    }
    submissionId = submission.id;
  }

  const latestOrder = await loadCustomerOrderById(e, order.id) || order;
  if (latestOrder.status !== "pending_payment" || await attachedSaleReference(e, latestOrder)) {
    await e.DB.prepare("UPDATE payment_receipt_submissions SET status='superseded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='forwarding'").bind(submissionId).run();
    return handlePaidClaim(e, chat, user, latestOrder);
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: e.ADMIN_TELEGRAM_ID,
      caption: receiptAdminCaption(latestOrder, submissionId),
      parse_mode: "HTML"
    };
    payload[media.kind] = media.fileId;
    await tg(e, media.kind === "photo" ? "sendPhoto" : "sendDocument", payload);
  } catch {
    await e.DB.prepare("UPDATE payment_receipt_submissions SET status='delivery_failed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='forwarding'").bind(submissionId).run();
    await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, latestOrder.id, latestOrder.kind).run();
    console.error("Receipt forwarding failed");
    return say(e, chat, "I couldn't forward that receipt to the administrator just now. Your order remains pending and nothing was marked paid. Please send the same Selar receipt again in a moment.");
  }

  await e.DB.prepare("UPDATE payment_receipt_submissions SET status='forwarded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='forwarding'").bind(submissionId).run();
  await clearPaymentPrompts(e, user, latestOrder.id);
  return say(e, chat, "Thanks — your Selar receipt has been forwarded to the administrator with your order details for manual review. This does <b>not</b> mark your order paid or verified. The administrator must check Selar first, and contact details or fulfilment are only released through the existing manual process.");
}

async function start(e: Env, m: Msg, payload: string) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id), rawId = payload.replace(/^contact_/, "");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(rawId)) return say(e, chat, "Invalid profile link. Open the Message button directly from FansLeak.");
  let profile: Profile | undefined;
  try {
    const profiles = await catalogue(e);
    // Telegram start parameters only allow [A-Za-z0-9_-], so the website encodes "."
    // in profile IDs as "_dot_" (e.g. emanuela.ebony -> contact_emanuela_dot_ebony).
    // Exact catalogue matches win; the decoded form is only a fallback lookup.
    profile = profiles.find(p => p.id === rawId) || profiles.find(p => p.id === rawId.replace(/_dot_/g, "."));
  }
  catch { return say(e, chat, "I can't load the live FansLeak profile list right now. Try again shortly."); }
  if (!profile) return say(e, chat, "That profile is not currently in the public FansLeak catalogue.");
  if (enabledMethods(e).length === 0) {
    await say(e, chat, "Contact requests are not accepting payments yet. Please try again later.");
    await notifyAdminIfConfigured(e, "Setup required: configure the Selar checkout URL and product code.");
    return;
  }
  // Contact requests and service orders are independent purchases. An open order
  // in one flow must not block the customer from starting the other flow.
  // Up to three unpaid contact requests are allowed per Telegram account.
  // A verified payment frees a slot; open requests never block conversation.
  const outstanding = await e.DB.prepare("SELECT COUNT(*) AS count FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment')").bind(user).first<any>();
  const outstandingCount = Number(outstanding?.count || 0);
  if (outstandingCount >= 3) {
    const rows = await e.DB.prepare("SELECT id,checkout_code FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment') ORDER BY created_at DESC LIMIT 3").bind(user).all<any>();
    const keyboard = { inline_keyboard: (rows.results || []).map(r => [{ text: `🔎 Check ${String(r.checkout_code || "request")}`, callback_data: `paid:${r.id}` }]) };
    return say(e, chat, "👋 You have 3 contact requests awaiting payment. You can still chat with me and check any request below. Once a payment is manually verified by our admin, that request no longer counts toward your three unpaid requests. 💬", keyboard);
  }
  const requestId = crypto.randomUUID();
  let code = "";
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    try {
      code = await generateUniqueCheckoutCode(e.DB);
    } catch {
      await notifyAdminIfConfigured(e, "Alert: Checkout code generation exhausted retries for contact request.");
      return say(e, chat, "Unable to generate an order code right now. Please try again in a moment.");
    }
    try {
      await e.DB.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,telegram_username,profile_id,status,payment_method,checkout_code) VALUES(?,?,?,?,?,'pending_payment','selar',?)").bind(requestId, user, chat, m.from?.username || "", profile.id, code).run();
      inserted = true;
    } catch {
      // The checkout code raced another insert (retry with a fresh code), or a second
      // active request raced us and hit the one-active-request unique index. Either
      // way, never send a success message for a request that was not stored.
      let raced: unknown = null;
      try { raced = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first(); } catch { /* fall through to the failure message below */ }
      if (raced) return say(e, chat, "👋 I found an existing request, but couldn't create another one just now. You can still chat with me or tap Check payment on an earlier request. Please try again shortly. 💬");
    }
  }
  if (!inserted) return say(e, chat, "I couldn't start your request just now. Please try again in a moment.");
  const intro = `Hi! I’m the FansLeak contact assistant for ${esc(profile.name)}. I’ve started your contact request for ${esc(profile.name)} and created your unique order code: <code>${esc(code)}</code>.`;
  const instructions = `Tap the Selar button below to open the checkout. In the customer name field, enter your full name followed by this code exactly, for example: <code>Joseph Unaogu ${esc(code)}</code>. This lets the admin match your payment to the correct request. If matching later needs help, you can send your email as a fallback clue.`;
  return say(e, chat, `${intro}\n\n${instructions}`, paymentKeyboard(e, requestId));
}

async function aiReply(e: Env, chat: string, userText: string, reminder = "", voiceReply = false) {
  if (!e.AI) return say(e, chat, reminder || "👋 I'm the FansLeak front-desk assistant. I can help with your requests, payment checks, and next steps. What can I help you with?");
  try {
    // Supply read-only context from this customer's own request history. The
    // model cannot execute SQL/admin actions; payment checks are deterministic.
    let history = "Request history unavailable.";
    try {
      const contacts = await e.DB.prepare("SELECT checkout_code,status,profile_id,created_at,payment_reference FROM contact_requests WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 3").bind(chat).all<any>();
      const services = await e.DB.prepare("SELECT checkout_code,status,service_id AS target_id,created_at,payment_reference FROM service_orders WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 2").bind(chat).all<any>();
      history = JSON.stringify({
        contactRequests: (contacts.results || []).map(r => ({ code: r.checkout_code || null, status: r.status, profileId: r.profile_id, createdAt: r.created_at, saleReferenceAttached: Boolean(r.payment_reference) })),
        serviceOrders: (services.results || []).map(r => ({ code: r.checkout_code || null, status: r.status, serviceId: r.target_id, createdAt: r.created_at, saleReferenceAttached: Boolean(r.payment_reference) }))
      });
    } catch { /* allow a conversation even if history is unavailable */ }
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You are FansLeak's natural, warm, capable front-desk assistant. Respond directly to what the person actually said, like a helpful human support agent; do not use a canned greeting or repeat the same payment reminder in every reply. Ask one relevant follow-up question only when needed. Use the read-only context about this Telegram user's own contact requests and service orders to answer questions about their specific order; name the relevant FL code and explain the next step when useful. If they ask about a different matter, answer that matter rather than forcing the conversation back to payment. If they want to create another contact request, explain the three-unpaid-request limit only when their saved requests show they have reached it, and offer them a way to check an existing request. Mention 'I've paid — check again' only when payment checking is relevant. Never say an admin is reviewing a payment unless the saved state or attached sale reference supports that. Never promise an ETA. You cannot execute commands, SQL, payment verification, approval, consent changes, or delivery; deterministic handlers perform permitted actions. Never claim payment received, verified, approved, or fulfilled unless the saved status says so. Never invent profile, payment, or creator information. Never reveal or invent a creator's Telegram username, phone number, or private contact details. Never ask for passwords, card PINs, bank credentials, or OTPs. Keep replies concise, natural, and plain text." },
        { role: "user", content: `Customer message: ${userText.slice(0, 1500)}\\nRead-only request history: ${history.slice(0, 3500)}` }
      ]
    });
    const answer = String(result?.response || "").trim().slice(0, 3500);
    return say(e, chat, answer ? esc(answer) : (reminder || "I couldn't answer that just now. Please try again shortly."));
  } catch (err) {
    console.error("AI support reply failed", String(err));
    return say(e, chat, reminder || "I can't answer that just now. Please try again shortly or contact the admin.");
  }
}

async function startService(e: Env, m: Msg, serviceId: string) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(serviceId)) return say(e, chat, "Invalid service purchase link.");
  if (!e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || provider(e) !== "selar") {
    await say(e, chat, "This service purchase is not accepting orders yet. Please try again later.");
    await notifyAdminIfConfigured(e, "Service purchase setup required: configure the service Selar checkout URL and product code.");
    return;
  }
  // Service orders and creator contact requests are independent purchases.
  const active = await e.DB.prepare("SELECT id,checkout_code,status,service_id,request_text FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  if (active) return say(e, chat, "👋 Welcome back — your existing service order is still here.\n\nOrder code: <code>" + esc(String(active.checkout_code || "not assigned")) + "</code>\nStatus: <b>" + esc(String(active.status)) + "</b>\n\nYou can keep chatting with me normally about this order. If you are describing the work, tell me what you need; when ready to pay, type PAY. I won’t create a duplicate order.");
  const id = crypto.randomUUID();
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    let code: string;
    try {
      code = await generateUniqueCheckoutCode(e.DB);
    } catch {
      await notifyAdminIfConfigured(e, "Alert: Service checkout code generation exhausted retries for service order.");
      return say(e, chat, "Unable to generate an order code right now. Please try again in a moment.");
    }
    try {
      await e.DB.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,checkout_code) VALUES(?,?,?,?,?,'awaiting_request',?)").bind(id, serviceId, user, chat, m.from?.username || "", code).run();
      inserted = true;
    } catch {
      let raced: unknown = null;
      try { raced = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first(); } catch { /* fall through to the failure message below */ }
      if (raced) return say(e, chat, "👋 You already have a service order open. I can still help you here — continue describing what you need, or type PAY when you are ready to check out.");
    }
  }
  if (!inserted) return say(e, chat, "I couldn't start your service order just now. Please try again in a moment.");
  return say(e, chat, "Hi! I’m the FansLeak AI assistant. Tell me what you need, and I’ll ask a few questions so I understand your request.\n\nOrder reference: <code>" + id + "</code>\n\nWhen you’re ready to pay, type PAY and I’ll send the checkout link.");
}

async function message(e: Env, m: Msg) {
  let t = (m.text || "").trim();
  const caption = (m.caption || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  const hasReceiptCandidateMedia = Boolean((Array.isArray(m.photo) && m.photo.length > 0) || m.document || m.video);
  if (hasReceiptCandidateMedia && user === e.ADMIN_TELEGRAM_ID) {
    const normalizedCaption = caption.replace(/^(\/[A-Za-z0-9_]+)@[A-Za-z0-9_]+(?=\s|$)/, "$1");
    if (normalizedCaption === "/message" || normalizedCaption.startsWith("/message ")) {
      const command = normalizedCaption.match(/^\/message\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
      if (!command) return say(e, chat, "Caption format: /message FL-ABC123 Your message here. This opens a draft only; it does not send.");
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB. No support draft was opened.");
      return createOrReopenAdminMessageDraft(e, m, command[1], command[2] || "", extracted.media);
    }

    const broadcastDraft = await activeBroadcastDraft(e, user);
    if (broadcastDraft && broadcastDraft.status === "draft") {
      const extracted = m.video?.file_id
        ? { media: { kind: "document" as const, fileId: m.video.file_id, fileUniqueId: m.video.file_unique_id || null, mimeType: m.video.mime_type || "video/mp4", fileSize: m.video.file_size || null } }
        : extractReceiptMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo or document under 20 MB.");
      const updated = await e.DB.prepare("UPDATE admin_broadcast_drafts SET media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(extracted.media.kind, extracted.media.fileId, extracted.media.mimeType, broadcastDraft.id, user).run();
      if (!updated.meta?.changes) return say(e, chat, "Broadcast draft changed; media was not attached.");
      return say(e, chat, "📎 Media attached. Nothing has been sent.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + broadcastDraft.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + broadcastDraft.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + broadcastDraft.id }]] });
    }
    const deliveryDraft = await activeDeliveryDraft(e, user);
    const supportDraft = await activeAdminMessageDraft(e, user);
    if (deliveryDraft && supportDraft) {
      return say(e, chat, "Two editable drafts are open, so the media was not attached to either one. Finish or cancel one draft, then send the media again.", {
        inline_keyboard: [[
          { text: "✖️ Cancel support draft", callback_data: "support-message:cancel:" + supportDraft.id },
          { text: "✖️ Cancel delivery draft", callback_data: "draft:cancel:" + deliveryDraft.id }
        ]]
      });
    }
    if (deliveryDraft) {
      const media = extractReceiptMedia(m);
      if (!media.media) return say(e,chat,media.unsupported || "Send one photo or document.");
      await e.DB.prepare("UPDATE delivery_drafts SET media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(media.media.kind,media.media.fileId,media.media.mimeType,deliveryDraft.id,user).run();
      return say(e,chat,"📎 Media attached to draft <code>"+esc(deliveryDraft.checkout_code || "request")+"</code>.",{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+deliveryDraft.id} ],[ {text:"✅ Send to customer",callback_data:"draft:send:"+deliveryDraft.id},{text:"✖️ Cancel",callback_data:"draft:cancel:"+deliveryDraft.id} ]]});
    }
    if (supportDraft) {
      if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to attach media to a customer support draft. Nothing was sent.");
      const contextBefore = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!contextBefore?.order || String(contextBefore.order.telegram_user_id) !== String(supportDraft.telegram_user_id) || String(contextBefore.order.telegram_chat_id) !== String(supportDraft.telegram_chat_id)) {
        return say(e, chat, "The support draft no longer matches the selected order's Telegram destination, so the media was not attached.", adminMessageKeyboard(supportDraft.id));
      }
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB. The support draft was not changed.");
      let nextText = supportDraft.message_text || null;
      let note = "";
      if (caption && !caption.startsWith("/")) {
        if (caption.length > ADMIN_MESSAGE_TEXT_LIMIT) return say(e, chat, "The media caption is too long to use as support text, so the media was not attached. Shorten the text and try again.");
        if (!adminMessageBody(supportDraft)) nextText = caption;
        else if (caption !== adminMessageBody(supportDraft)) note = "Existing draft text was kept; the media caption was not used as message text.";
      } else if (caption.startsWith("/")) {
        note = "The media caption was not used as message text.";
      }
      const updated = await e.DB.prepare("UPDATE admin_message_drafts SET message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?")
        .bind(nextText, extracted.media.kind, extracted.media.fileId, extracted.media.mimeType, supportDraft.id, user)
        .run();
      if (!updated.meta?.changes) return say(e, chat, "The support draft changed while media was being attached. Nothing was sent.");
      const context = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
      return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: "📎 <b>Customer support draft updated</b>", note: note || undefined });
    }
  }
  if (hasReceiptCandidateMedia) {
    const receiptPrompt = await e.DB.prepare("SELECT order_id,order_kind FROM receipt_review_prompts WHERE telegram_user_id=?").bind(user).first<any>();
    let order = receiptPrompt ? await loadCustomerOrderById(e, String(receiptPrompt.order_id)) : null;
    if (receiptPrompt && (!order || String(order.telegram_user_id) !== user)) {
      await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=?").bind(user).run();
      return say(e, chat, "That receipt prompt no longer matches a current order for this Telegram account, so I did not forward the file. Start from the profile or service page if you need to begin again.");
    }
    if (!order && user !== e.ADMIN_TELEGRAM_ID) {
      // The admin may also own a test/customer order, but unsolicited admin
      // media is not treated as a receipt without an explicit prompt.
      const candidate = await findCustomerOrderForPaidClaim(e, user);
      if (candidate?.status === "pending_payment") order = candidate;
    }
    if (order) return handleReceiptMedia(e, m, order);
    if (!caption) return;
    // A captioned image for a service still being described can continue through
    // the existing text flow; it is not treated as a payment receipt.
    t = caption;
  }
  let voiceReply = false;
  if (m.voice || m.audio) {
    try {
      t = await transcribeVoice(e, m);
      voiceReply = true;
      if (user !== e.ADMIN_TELEGRAM_ID) await sayBestEffort(e, chat, "🎙️ I heard: " + t);
    } catch (error) {
      console.error("Voice transcription failed", String(error));
      return say(e, chat, "Sorry, I couldn’t understand that voice note. Please try a clearer, shorter recording or send the message as text.");
    }
  }
  if (Array.isArray(m.photo) && m.photo.length > 0 && !t) {
    try {
      const answer = await analysePhoto(e, m, caption);
      await say(e, chat, "🖼️ " + esc(answer));
      return;
    } catch (error) {
      console.error("Image analysis failed", String(error));
      return say(e, chat, "I couldn’t analyse that image just now. Please try a smaller photo or describe what you want me to look at.");
    }
  }
  if (!t) return;
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && /^(?:yes|yes please|confirm|confirm it|go ahead|do it)[.! ]*$/i.test(t)) {
    const pending = await e.DB.prepare("SELECT id,admin_telegram_id,action,payload,status,expires_at FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (pending) { await confirmPendingAdminAction(e, user, chat, String(pending.id)); return; }
    const broadcastDraft = await activeBroadcastDraft(e, user);
    if (broadcastDraft?.status === "draft") { await executeBroadcast(e, user, chat, broadcastDraft); return; }
    const supportDraft = await activeAdminMessageDraft(e, user);
    if (supportDraft?.status === "draft") { await executeSupportDraft(e, user, chat, supportDraft.id); return; }
  }
  if (user === e.ADMIN_TELEGRAM_ID && !t.startsWith("/") && chat === user) {
    const broadcastDraft = await activeBroadcastDraft(e, user);
    if (broadcastDraft && broadcastDraft.status === "draft") {
      if (t.length > 900) return say(e, chat, "Broadcast text must be 900 characters or fewer. The draft was not changed.");
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t, broadcastDraft.id, user).run();
      return say(e, chat, "📝 Broadcast text updated. Nothing has been sent.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + broadcastDraft.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + broadcastDraft.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + broadcastDraft.id }]] });
    }
  }
  // Ordinary admin text can edit exactly one open composer. If both editable
  // workflows somehow have a draft, fail closed instead of guessing.
  if (user === e.ADMIN_TELEGRAM_ID && !t.startsWith("/")) {
    const deliveryDraft = await activeDeliveryDraft(e, user);
    const supportDraft = await activeAdminMessageDraft(e, user);
    if (deliveryDraft && supportDraft) {
      return say(e, chat, "Two editable drafts are open, so that text was not added to either one. Finish or cancel one draft, then send the text again.", {
        inline_keyboard: [[
          { text: "✖️ Cancel support draft", callback_data: "support-message:cancel:" + supportDraft.id },
          { text: "✖️ Cancel delivery draft", callback_data: "draft:cancel:" + deliveryDraft.id }
        ]]
      });
    }
    if (deliveryDraft) {
      if (t.length > 700) return say(e,chat,"Please keep delivery text under 700 characters.");
      await e.DB.prepare("UPDATE delivery_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t,deliveryDraft.id,user).run();
      return say(e,chat,"📝 Draft updated for <code>"+esc(deliveryDraft.checkout_code || "request")+"</code>. Optionally attach one photo or document, then preview before sending.",{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+deliveryDraft.id} ],[ {text:"✅ Send to customer",callback_data:"draft:send:"+deliveryDraft.id},{text:"✖️ Cancel",callback_data:"draft:cancel:"+deliveryDraft.id} ]]});
    }
    if (supportDraft && chat === user) {
      if (t.length > ADMIN_MESSAGE_TEXT_LIMIT) return say(e, chat, "Support message text is too long. Keep it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer. The draft was not changed.");
      const contextBefore = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!contextBefore?.order || String(contextBefore.order.telegram_user_id) !== String(supportDraft.telegram_user_id) || String(contextBefore.order.telegram_chat_id) !== String(supportDraft.telegram_chat_id)) {
        return say(e, chat, "The support draft no longer matches the selected order's Telegram destination, so the text was not added.", adminMessageKeyboard(supportDraft.id));
      }
      const updated = await e.DB.prepare("UPDATE admin_message_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t, supportDraft.id, user).run();
      if (!updated.meta?.changes) return say(e, chat, "The support draft changed while it was being updated. Nothing was sent.");
      const context = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
      return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: "📝 <b>Customer support draft updated</b>" });
    }
  }
  // Telegram may append @BotName to slash commands. Normalize only the command token.
  t = t.replace(/^([\/][A-Za-z0-9_]+)@[A-Za-z0-9_]+(?=\s|$)/, "$1");
  if (user === e.ADMIN_TELEGRAM_ID) {
    if (/^(?:list|show|view)\s+(?:all\s+)?profiles$/i.test(t)) t = "/profiles";
    else if (/^(?:list|show|view)\s+(?:recent\s+)?orders$/i.test(t)) t = "/orders";
    else if (/^delete\s+profile\s+(.+)$/i.test(t)) {
      const requested = t.match(/^delete\s+profile\s+(.+)$/i)[1].trim();
      const cat = await catalogue(e);
      const profile = cat.find(p => p.id.toLowerCase() === requested.toLowerCase() || p.name.toLowerCase() === requested.toLowerCase());
      if (!profile) return say(e, chat, "I couldn't match that name to a visible profile. Send the exact profile name or ID from /profiles.");
      t = "/deleteprofile " + profile.id;
    }
    else if (/^restore\s+profile\s+([A-Za-z0-9._-]{1,50})$/i.test(t)) t = "/restoreprofile " + t.match(/^restore\s+profile\s+([A-Za-z0-9._-]{1,50})$/i)[1];
    else if (/^(?:reject|decline)\s+(?:order\s+)?FL-[A-Z0-9]{6}$/i.test(t)) t = "/reject " + t.match(/FL-[A-Z0-9]{6}/i)[0];
    else if (/^(?:approve|deliver|fulfil|fulfill)\s+(?:order\s+)?FL-[A-Z0-9]{6}$/i.test(t)) t = "deliver " + t.match(/FL-[A-Z0-9]{6}/i)[0];
    else if (/^(?:send\s+)?broadcast(?:\s+to\s+(?:all\s+)?clients)?$/i.test(t) || /^send\s+(?:mass\s+)?messages?\s+to\s+clients$/i.test(t) || /^send\s+(?:photo|video|media)\s+to\s+clients$/i.test(t) || /^send\s+(?:a\s+)?message\s+to\s+all\s+clients$/i.test(t)) t = "/broadcast";
    else if (/^(?:send\s+)?broadcast\s*[:\-]?\s+[\s\S]+$/i.test(t)) t = "/broadcast " + t.replace(/^(?:send\s+)?broadcast\s*[:\-]?\s+/i, "");
    else if (/^(?:send\s+)?(?:a\s+)?message\s+to\s+customer\s+FL-[A-Z0-9]{6}\s*[:\-]\s*[\s\S]+$/i.test(t)) t = "/message " + t.replace(/^(?:send\s+)?(?:a\s+)?message\s+to\s+customer\s+(FL-[A-Z0-9]{6})\s*[:\-]\s*/i, "$1 ");
    else if (/^message\s+customer\s+FL-[A-Z0-9]{6}\s*[:\-]\s*[\s\S]+$/i.test(t)) t = "/message " + t.replace(/^message\s+customer\s+(FL-[A-Z0-9]{6})\s*[:\-]\s*/i, "$1 ");
    else if (/^(?:delete|close|cancel)\s+all\s+pending\s+orders$/i.test(t)) t = "/expirepending";
  }
  if (t.startsWith("/start")) {
    const arg = t.split(/\s+/, 2)[1] || "";
    if (arg.startsWith("contact_")) return start(e, m, arg);
    if (arg.startsWith("service_")) return startService(e, m, arg.slice("service_".length));
    let catSummary = "";
    try {
      const cat = await catalogue(e);
      if (cat.length > 0) {
        catSummary = `\n\nWe feature <b>${cat.length}</b> verified creators. Tap a profile's <b>Message / Request contact</b> button on the site, use /creators to see featured creators, or browse directly on FansLeak.`;
      }
    } catch { /* catalogue fetch non-fatal */ }
    return say(e, chat, `Welcome to the FansLeak Official Telegram Bot! 👋\n\nTo request contact details or an assessment with a creator, open their profile on FansLeak and tap the <b>Message / Request contact</b> button.${catSummary}\n\n⚠️ <i>Never send passwords, PINs or OTPs here. Support will never ask for your private credentials.</i>`);
  }
  if (t === "/creators" || t === "/profiles") {
    try {
      const cat = await catalogue(e);
      const featured = cat.slice(0, 10).map(p => `• <b>${esc(p.name)}</b> (ID: <code>${esc(p.id)}</code>)`).join("\n");
      const siteUrl = (e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "");
      return say(e, chat, `<b>FansLeak Featured Creators (${cat.length} total)</b>:\n\n${featured}\n\nVisit <a href="${siteUrl}">${siteUrl}</a> to view profiles and request contact.`);
    } catch {
      return say(e, chat, "Could not load the creator list right now. Please browse directly on FansLeak: https://fansleak.pages.dev");
    }
  }

  if (user === e.ADMIN_TELEGRAM_ID && /^\/broadcast(?:\s|$)/i.test(t)) {
    const text = t.replace(/^\/broadcast(?:@[A-Za-z0-9_]+)?\s*/i, "").trim();
    const active = await activeBroadcastDraft(e, user);
    if (active?.status === "sending") return say(e, chat, "⚠️ A broadcast is already sending or has an uncertain outcome. Check before retrying.");
    if (active?.status === "draft") return say(e, chat, "You already have a broadcast draft. Send text to update it, attach one photo/document, or use /broadcastcancel.");
    if (text.length > 900) return say(e, chat, "Broadcast text must be 900 characters or fewer.");
    const id = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO admin_broadcast_drafts(id,admin_telegram_id,message_text,status,expires_at) VALUES(?,?,?,'draft',datetime('now','+30 minutes'))").bind(id, user, text || null).run();
    return say(e, chat, "📣 <b>Broadcast draft created</b>\nAudience: customers with active/recent order records (maximum 100 recipients).\n\n" + (text ? esc(text) : "No message text yet. Send text or attach media.") + "\n\nNothing has been sent. Preview and confirm when ready.", {
      inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/broadcastcancel") {
    const draft = await activeBroadcastDraft(e, user);
    if (!draft || draft.status !== "draft") return say(e, chat, "No editable broadcast draft to cancel.");
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    return say(e, chat, "✖️ Broadcast draft cancelled. Nothing was sent.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/deleteprofile\s+/i.test(t)) {
    const match = t.match(/^\/deleteprofile\s+([A-Za-z0-9._-]{1,50})$/i);
    if (!match) return say(e, chat, "Usage: /deleteprofile PROFILE_ID");
    const profileId = match[1];
    const cat = await catalogue(e);
    const profile = cat.find(p => p.id === profileId);
    if (!profile) return say(e, chat, "That profile is not currently visible. Check /profiles or use /restoreprofile PROFILE_ID.");
    const id = await createPendingAdminAction(e, user, "hide_profile", profileId);
    if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another.");
    return say(e, chat, "⚠️ <b>Remove website profile?</b>\n" + esc(profile.name) + " (<code>" + esc(profile.id) + "</code>) will be hidden from public listings and the Telegram request catalogue. The source profile files remain recoverable in GitHub.\n\nReply <b>YES</b> or use the button to confirm.", {
      inline_keyboard: [[{ text: "🗑️ Confirm hide profile", callback_data: "admin-action:confirm:" + id }], [{ text: "Cancel", callback_data: "admin-action:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/expirepending") {
    const contacts = await e.DB.prepare("SELECT COUNT(*) AS total FROM contact_requests WHERE status IN ('awaiting_email','pending_payment','awaiting_bank_reference','pending_manual_payment')").first<any>();
    const services = await e.DB.prepare("SELECT COUNT(*) AS total FROM service_orders WHERE status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','payment_review')").first<any>();
    const id = await createPendingAdminAction(e, user, "close_pending_orders", null);
    if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another.");
    return say(e, chat, "⚠️ <b>Close all pending orders?</b>\nContact requests to expire: <b>" + Number(contacts?.total || 0) + "</b>\nService orders to cancel: <b>" + Number(services?.total || 0) + "</b>\n\nThis retains audit records and does not verify or approve payments. Reply <b>YES</b> or use the button to confirm.", {
      inline_keyboard: [[{ text: "✅ Confirm close pending orders", callback_data: "admin-action:confirm:" + id }], [{ text: "Cancel", callback_data: "admin-action:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/restoreprofile\s+/i.test(t)) {
    const match = t.match(/^\/restoreprofile\s+([A-Za-z0-9._-]{1,50})$/i);
    if (!match) return say(e, chat, "Usage: /restoreprofile PROFILE_ID");
    const result = await e.DB.prepare("DELETE FROM hidden_profiles WHERE profile_id=?").bind(match[1]).run();
    if (!result.meta?.changes) return say(e, chat, "That profile was not hidden, or the ID is invalid.");
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'profile_restored',?,'Admin restored profile visibility')").bind(user, match[1]).run();
    return say(e, chat, "✅ Profile visibility restored for <code>" + esc(match[1]) + "</code>. Refresh the website to see it again.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/admin" || t === "/menu")) {
    return say(e, chat, "<b>FansLeak Admin Desk</b>\nChoose what you want to manage. Payment checks and contact release remain manual and explicitly confirmed.", {
      inline_keyboard: [
        [{ text: "📥 Review contact requests", callback_data: "admin:pending" }],
        [{ text: "🧾 Review service orders", callback_data: "admin:orders" }],
        [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }],
        [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]
      ]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/profiles" || /^list profiles$/i.test(t))) {
    const cat = await catalogue(e);
    const lines = cat.map((p, i) => String(i + 1) + ". <b>" + esc(p.name) + "</b> · <code>" + esc(p.id) + "</code>");
    return say(e, chat, "<b>📚 Current website profiles (" + cat.length + ")</b>\n" + (lines.join("\n") || "No profiles found."));
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/orders" || /^show orders$/i.test(t))) {
    const contacts = await e.DB.prepare("SELECT checkout_code,status,profile_id AS target,created_at,'contact' AS kind FROM contact_requests ORDER BY created_at DESC LIMIT 15").all<any>();
    const services = await e.DB.prepare("SELECT checkout_code,status,service_id AS target,created_at,'service' AS kind FROM service_orders ORDER BY created_at DESC LIMIT 15").all<any>();
    const rows = [...(contacts.results || []), ...(services.results || [])].sort((a:any,b:any) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0,20);
    const lines = rows.map((r:any) => "• <code>" + esc(String(r.checkout_code || "no code")) + "</code> · " + esc(String(r.kind)) + " · " + esc(String(r.target || "")) + " · " + esc(String(r.status)));
    return say(e, chat, "<b>🧾 Recent orders (" + rows.length + ")</b>\n" + (lines.join("\n") || "No orders found."));
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/reject\s+/i.test(t)) {
    const match = t.match(/^\/reject\s+(FL-[A-Z0-9]{6})$/i);
    if (!match) return say(e, chat, "Usage: /reject FL-ABC123 — rejects the selected order and notifies its customer.");
    const code = match[1].toUpperCase();
    const contact = await e.DB.prepare("SELECT id,telegram_chat_id,status FROM contact_requests WHERE checkout_code=?").bind(code).first<any>();
    if (contact) {
      if (["approved","rejected","expired"].includes(String(contact.status))) return say(e, chat, "Request " + esc(code) + " is already " + esc(String(contact.status)) + ". No change made.");
      const changed = await e.DB.prepare("UPDATE contact_requests SET status='rejected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('awaiting_email','pending_payment','awaiting_bank_reference','pending_manual_payment','payment_verified')").bind(contact.id).run();
      if (!changed.meta?.changes) return say(e, chat, "Request state changed before rejection. Refresh /orders; no success was reported.");
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'admin_request_rejected',?,?)").bind(user, contact.id, "Admin rejected request " + code).run();
      await sayBestEffort(e, contact.telegram_chat_id, "Your FansLeak request " + code + " was rejected by support. If you think this is a mistake, reply here to contact support.");
      return say(e, chat, "🚫 Request " + esc(code) + " rejected and customer notified.");
    }
    const service = await e.DB.prepare("SELECT id,telegram_chat_id,status FROM service_orders WHERE checkout_code=?").bind(code).first<any>();
    if (!service) return say(e, chat, "No contact request or service order found for " + esc(code) + ".");
    if (["fulfilled","cancelled"].includes(String(service.status))) return say(e, chat, "Service order " + esc(code) + " is already " + esc(String(service.status)) + ". No change made.");
    const changed = await e.DB.prepare("UPDATE service_orders SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','payment_review')").bind(service.id).run();
    if (!changed.meta?.changes) return say(e, chat, "Service order state changed before cancellation. Refresh /orders; no success was reported.");
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'admin_service_order_cancelled',?,?)").bind(user, service.id, "Admin cancelled service order " + code).run();
    await sayBestEffort(e, service.telegram_chat_id, "Your FansLeak service order " + code + " was cancelled by support. Reply here if you need help.");
    return say(e, chat, "🚫 Service order " + esc(code) + " cancelled and customer notified.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/message" || t.startsWith("/message "))) {
    const match = t.match(/^\/message\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
    if (!match) return say(e, chat, "Format: /message FL-ABC123 Your message here\nYou may also use /message FL-ABC123 on its own, then send text and/or one photo or document. This opens a draft only; it does not send.");
    return createOrReopenAdminMessageDraft(e, m, match[1], match[2] || "");
  }

  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/deliver ")) {
    const match = t.match(/^\/deliver\s+([0-9a-f-]{36})\s+([\s\S]{1,3500})$/i);
    if (!match) return say(e, chat, "Usage: /deliver ORDER_UUID fulfilment text — this creates a draft for preview and confirmation.");
    const order = await e.DB.prepare("SELECT id,checkout_code,status FROM service_orders WHERE id=?").bind(match[1]).first<any>();
    if (!order || order.status !== "payment_verified") return say(e, chat, "Order not found or payment has not been verified. Nothing was sent.");
    const existing = await e.DB.prepare("SELECT id,status FROM service_delivery_drafts WHERE service_order_id=?").bind(order.id).first<any>();
    if (existing && (existing.status === "sent" || existing.status === "sending")) return say(e, chat, "A fulfilment draft was already sent or has an uncertain delivery outcome. Inspect Telegram before any retry.");
    const draftId = existing?.id || crypto.randomUUID();
    if (existing) {
      const updated = await e.DB.prepare("UPDATE service_delivery_drafts SET admin_telegram_id=?,message_text=?,status='draft',expires_at=datetime('now','+30 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('draft','cancelled','expired')").bind(user,match[2],draftId).run();
      if (!updated.meta?.changes) return say(e,chat,"Could not reopen the draft because its state changed. Nothing was sent.");
    } else {
      await e.DB.prepare("INSERT INTO service_delivery_drafts(id,service_order_id,admin_telegram_id,message_text,status,expires_at) VALUES(?,?,?,?,'draft',datetime('now','+30 minutes'))").bind(draftId,order.id,user,match[2]).run();
    }
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_delivery_draft_created',?,?)").bind(user,order.id,"Admin created fulfilment draft; no customer message sent").run();
    return say(e,chat,"📝 <b>Service fulfilment preview</b>\nOrder: <code>"+esc(String(order.checkout_code||order.id))+"</code>\n\n"+esc(match[2])+"\n\n<i>Draft only — nothing has been sent. Expires in 30 minutes.</i>",{inline_keyboard:[[ {text:"✅ Confirm and send",callback_data:"service-delivery:send:"+draftId},{text:"✖️ Cancel",callback_data:"service-delivery:cancel:"+draftId} ]]});
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/orders") {
    const rows = await e.DB.prepare("SELECT id,service_id,telegram_username,telegram_user_id,status,CASE WHEN status='payment_verified' THEN substr(request_text,-180) ELSE 'Request hidden until payment verification' END AS summary FROM service_orders ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => [r.id, r.service_id, "@" + (r.telegram_username || "unknown"), "Telegram " + r.telegram_user_id, r.status, String(r.summary || "")].map(x => esc(String(x))).join(" | ")).join("\n") || "No service orders.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/setcontact ")) {
    const [, id, handle] = t.split(/\s+/);
    if (!id || !/^[A-Za-z0-9._-]{1,50}$/.test(id) || !handle || !/^@[A-Za-z0-9_]{5,32}$/.test(handle)) return say(e, chat, "Usage: /setcontact PROFILE_ID @telegram_handle");
    const cat = await catalogue(e);
    if (!cat.some(p => p.id === id)) return say(e, chat, "That profile is not in the current public catalogue.");
    await e.DB.prepare("INSERT INTO creator_contacts(profile_id,contact_value) VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET contact_value=excluded.contact_value,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id, handle).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'contact_saved',?,'Admin saved the contact for verified contact-request fulfilment')").bind(user, id).run();
    return say(e, chat, `✅ Saved ${esc(handle)} for ${esc(id)}. It can be included in a contact delivery only after the matching payment is manually verified and you confirm delivery.`);
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/pending") {
    const rows = await e.DB.prepare("SELECT id,profile_id,buyer_email,status,checkout_code,payment_reference FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => [r.id, r.profile_id, r.buyer_email || "-", r.status, "code " + (r.checkout_code || "-"), r.payment_reference ? "sale ref attached" : "no sale ref"].map(x => esc(String(x))).join(" | ")).join("\n") || "No pending requests.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/help") {
    return say(e, chat, [
      "<b>Admin commands</b>",
      "/pending — contact requests awaiting payment verification or final approval",
      "/orders — recent service orders",
      "/verify REQUEST_UUID SELAR_REFERENCE — manually verify a contact payment after checking it in Selar (only when no webhook sale is attached)",
      "/verifyservice ORDER_UUID SELAR_REFERENCE — manually verify a service payment after checking it in Selar",
      "/deliver ORDER_UUID fulfilment text — send fulfilment for a verified service order",
      "/message ORDER_CODE_OR_UUID [text] — open a customer support draft; add text and/or one photo/document, then preview and explicitly send or cancel",
      "/setcontact PROFILE_ID @handle — save the contact used for verified contact-request fulfilment",
      "",
      "If a customer says they paid and no backend sale is attached, the bot may forward their Selar receipt here with the order context and exact /verify command. A receipt is evidence only and never changes payment status by itself.",
      "Payments are never verified automatically. Contact delivery is a separate, explicit admin action after manual payment verification."
    ].join("\n"));
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t.startsWith("/verify ") || t.startsWith("/verifyservice "))) {
    // Manual verification path for payments the admin has checked directly in Selar
    // (e.g. the sale webhook never arrived). This admin action IS the verification;
    // it never approves a contact request or sends creator contact details by itself.
    const isService = t.startsWith("/verifyservice ");
    const parts = t.split(/\s+/);
    const oid = parts[1] || "", reference = parts[2] || "";
    if (parts.length !== 3 || !/^[0-9a-f-]{36}$/i.test(oid) || !reference || reference.length > 200 || /[\s<>]/.test(reference)) {
      return say(e, chat, isService
        ? "Usage: /verifyservice ORDER_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference."
        : "Usage: /verify REQUEST_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference.");
    }
    const table = isService ? "service_orders" : "contact_requests";
    const row = await e.DB.prepare(`SELECT id,telegram_chat_id,status,payment_reference,buyer_email,${isService ? "service_id" : "profile_id"} AS target_id FROM ${table} WHERE id=?`).bind(oid).first<any>();
    if (!row) return say(e, chat, "Order not found. Nothing was changed.");
    if (row.status === "payment_verified" && row.payment_reference === reference) return say(e, chat, "Already verified with that reference. No change made.");
    if (row.status !== "pending_payment") return say(e, chat, `Cannot verify: order status is ${esc(String(row.status))}. Only pending_payment orders can be verified. Nothing was changed.`);
    if (row.payment_reference && row.payment_reference !== reference) return say(e, chat, "A different sale reference is already attached to this order. Resolve the mismatch in Selar first. Nothing was changed.");
    const usedSale = await e.DB.prepare("SELECT request_id FROM processed_sales WHERE provider_reference=?").bind(reference).first<any>();
    if (usedSale && usedSale.request_id !== oid) return say(e, chat, "That reference is already recorded for a different order. Nothing was changed.");
    const usedContact = await e.DB.prepare("SELECT id FROM contact_requests WHERE payment_reference=? AND id<>?").bind(reference, oid).first<any>();
    const usedService = await e.DB.prepare("SELECT id FROM service_orders WHERE payment_reference=? AND id<>?").bind(reference, oid).first<any>();
    if (usedContact || usedService) return say(e, chat, "That reference is already attached to a different order. Nothing was changed.");
    const productId = isService ? (e.SERVICE_PRODUCT_ID || "") : (e.SELAR_PRODUCT_ID || "");
    if (!productId) return say(e, chat, "The Selar product code is not configured for this flow. Nothing was changed.");
    const upd = await e.DB.prepare(`UPDATE ${table} SET status='payment_verified',payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'`).bind(reference, oid).run();
    if (!upd.meta?.changes) return say(e, chat, "Order status changed while verifying. No change made.");
    await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(reference, row.buyer_email || "", 0, "UNK", productId, oid).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)").bind(user, isService ? "service_payment_admin_verified_manual_reference" : "selar_payment_admin_verified_manual_reference", oid, row.target_id || null, `Admin manually verified after checking Selar directly; reference ${reference}`).run();
    if (isService) {
      await sayBestEffort(e, row.telegram_chat_id, "The admin has manually confirmed your payment. Your service order is awaiting fulfilment.");
      return say(e, chat, "Payment manually verified for service order <code>" + esc(oid) + "</code>. Use /deliver " + esc(oid) + " your service details when ready.");
    }
    await sayBestEffort(e, row.telegram_chat_id, "The admin has manually confirmed your payment after checking it with the payment provider. Your request is now waiting for final approval.");
    return say(e, chat, "Payment manually verified for contact request <code>" + esc(oid) + "</code>. It still needs your final approval (and recorded creator consent) before any contact details are sent.", { inline_keyboard: [[{ text: "Approve & send contact", callback_data: "approve:" + oid }, { text: "Reject", callback_data: "reject:" + oid }]] });
  }

  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/")) return say(e, chat, "I don't recognise that admin command. Open /admin for the button menu or /help for the available commands.");

  if (isPaidClaimText(t)) {
    const order = await findCustomerOrderForPaidClaim(e, user);
    const claimedCode = codeInName(t);
    if (claimedCode && order?.checkout_code && order.checkout_code !== claimedCode) {
      return say(e, chat, "That order code doesn't match the current request or order for this Telegram account. I did not check or change any other customer's order. Please use the code shown by the bot for your own checkout.");
    }
    return handlePaidClaim(e, chat, user, order);
  }

  const serviceOrder = await e.DB.prepare("SELECT id,status,request_text,checkout_code FROM service_orders WHERE telegram_user_id=? AND status='awaiting_request' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  if (serviceOrder) {
    if (/^\/?(pay|checkout|ready to pay)$/i.test(t)) {
      const requestText = String(serviceOrder.request_text || "").trim();
      if (requestText.length < 3) return say(e, chat, "First, tell me what you need so I can understand your request.");
      if (!e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || provider(e) !== "selar") return say(e, chat, "The service checkout is not configured yet. Please try again later.");
      await e.DB.prepare("UPDATE service_orders SET status='pending_payment',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(serviceOrder.id).run();
      const checkout = new URL(e.SERVICE_CHECKOUT_URL);
      checkout.searchParams.set("add_to_cart", "1");
      const markup = {
        inline_keyboard: [
          [{ text: "Open Service Checkout ↗️", url: checkout.toString() }],
          [{ text: "✅ Done — checkout completed", callback_data: `done:${serviceOrder.id}` }],
          [{ text: "🔎 I've paid — check again", callback_data: `paid:${serviceOrder.id}` }]
        ]
      };
      return say(e, chat, "Open the Selar checkout below. In the name field, enter your full name followed by this code exactly: <code>" + esc(serviceOrder.checkout_code) + "</code>. Example: <code>Joseph Unaogu " + esc(serviceOrder.checkout_code) + "</code>\n\nAfter completing checkout on Selar, return here and tap Done or “I've paid” below. The bot first checks for an existing backend sale record; only if none is attached will it ask you to forward your Selar receipt for manual review. If matching later needs help, you can send your email as a fallback clue.", markup);
    }
    if (t.length < 2 || t.length > 2000) return say(e, chat, "Please send a message between 2 and 2,000 characters.");
    const previous = String(serviceOrder.request_text || "");
    const updated = (previous + (previous ? "\nCustomer: " : "Customer: ") + t).slice(-8000);
    await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(updated, serviceOrder.id).run();
    if (!e.AI) return say(e, chat, "Thanks. Tell me a little more about what you need, or type PAY when you’re ready to purchase.");
    try {
      const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: "You are the FansLeak AI service assistant. Talk naturally and briefly with the customer to understand their service request. Ask one useful clarifying question at a time." },
          { role: "user", content: t.slice(0, 1500) }
        ]
      });
      const answer = String(result?.response || "").trim().slice(0, 2500);
      if (answer) {
        const transcript = (updated + "\nAssistant: " + answer).slice(-8000);
        await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(transcript, serviceOrder.id).run();
      }
      const finalAnswer = answer ? answer : "Thanks. Tell me a little more about what you need, or type PAY when you’re ready to purchase.";
      await say(e, chat, esc(finalAnswer));
      if (voiceReply) {
        const sent = await sendVoiceReply(e, chat, finalAnswer);
        if (!sent) await sayBestEffort(e, chat, "🔊 I couldn’t generate an audio reply this time, so I’ve sent the answer as text.");
      }
      return;
    } catch (err) {
      console.error("AI service conversation failed", String(err));
      return say(e, chat, "I saved your message. You can tell me more, or type PAY when you’re ready to purchase.");
    }
  }
  const prompt = await e.DB.prepare("SELECT order_id,order_kind FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).first<any>();
  if (prompt && !emailRe.test(t)) {
    const code = codeInName(t);
    if (!code) return say(e, chat, "I couldn't find the order code. Please send your exact full name followed by the code shown in checkout, for example: Joseph Unaogu FL-7K4P9A.");
    const fullName = t.replace(new RegExp("\\s*" + code + "\\s*$", "i"), "").trim();
    if (fullName.length < 2) return say(e, chat, "Please include your full name before the code, for example: Joseph Unaogu " + code + ".");
    const table = prompt.order_kind === "contact" ? "contact_requests" : "service_orders";
    const targetColumn = prompt.order_kind === "contact" ? "profile_id" : "service_id";
    const rawOrder = await e.DB.prepare(`SELECT id,telegram_user_id,telegram_chat_id,telegram_username,${targetColumn} AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM ${table} WHERE id=? AND telegram_user_id=?`).bind(prompt.order_id, user).first<any>();
    if (!rawOrder || rawOrder.status !== "pending_payment" || rawOrder.checkout_code !== code) return say(e, chat, "That code doesn't match your pending order. Please copy the exact code shown by the bot and try again.");
    await e.DB.prepare(`UPDATE ${table} SET checkout_name=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND telegram_user_id=? AND status='pending_payment'`).bind(fullName, rawOrder.id, user).run();
    await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).run();
    const order: CustomerOrder = { kind: prompt.order_kind === "contact" ? "contact" : "service", ...rawOrder, checkout_name: fullName };
    return handlePaidClaim(e, chat, user, order, { nameJustRecorded: true });
  }
  const submittedCode = codeInName(t);
  if (submittedCode) return say(e, chat, "To submit your checkout name, tap Done on your checkout instructions first.");
  if (emailRe.test(t)) {
    const email = t.toLowerCase();
    const req = await e.DB.prepare("SELECT id,status,profile_id,buyer_email,checkout_code FROM contact_requests WHERE telegram_user_id=? AND status='pending_payment' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (req?.status === "pending_payment" && !req.buyer_email) {
      await e.DB.prepare("UPDATE contact_requests SET buyer_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(email, req.id).run();
      if (e.ADMIN_TELEGRAM_ID) {
        await say(e, e.ADMIN_TELEGRAM_ID, `Customer supplied a reconciliation clue for contact request <code>${esc(req.id)}</code>\nProfile: ${esc(req.profile_id || "unknown")}\nOrder code: <code>${esc(req.checkout_code || "")}</code>\nEmail: <code>${esc(email)}</code>\nThis is a customer-provided reconciliation clue only and does not verify payment or approve the request.`);
      }
      return say(e, chat, "Thanks — your email has been saved as a fallback reconciliation clue. It is only used if the admin needs to match a payment manually, and it does not verify payment.");
    }
    const serv = await e.DB.prepare("SELECT id,status,service_id,buyer_email,checkout_code FROM service_orders WHERE telegram_user_id=? AND status='pending_payment' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (serv?.status === "pending_payment" && !serv.buyer_email) {
      await e.DB.prepare("UPDATE service_orders SET buyer_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(email, serv.id).run();
      if (e.ADMIN_TELEGRAM_ID) {
        await say(e, e.ADMIN_TELEGRAM_ID, `Customer supplied a reconciliation clue for service order <code>${esc(serv.id)}</code>\nService: ${esc(serv.service_id || "unknown")}\nOrder code: <code>${esc(serv.checkout_code || "")}</code>\nEmail: <code>${esc(email)}</code>\nThis is a customer-provided reconciliation clue only and does not verify payment or fulfil the order.`);
      }
      return say(e, chat, "Thanks — your email has been saved as a fallback reconciliation clue. It is only used if the admin needs to match a payment manually, and it does not verify payment.");
    }
  }
  if (user === e.ADMIN_TELEGRAM_ID) {
    const intent = t.toLowerCase().replace(/[!?.,]/g," ").replace(/\s+/g," ").trim();
    if (/^(show|list|view)? ?(pending )?(contact )?requests?$/.test(intent) || intent.includes("pending contact requests")) {
      const rows=await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE status IN ('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 15").all<any>();
      const lines=(rows.results||[]).map((r:any)=>"• <code>"+esc(r.checkout_code||r.id)+"</code> · "+esc(r.profile_id)+" · "+esc(r.status)+" · "+(r.payment_reference?"sale attached":"no sale attached"));
      return say(e,chat,"<b>📥 Pending contact requests</b>\n"+(lines.join("\n")||"No pending contact requests."));
    }
    if (intent.includes("awaiting verification") || intent.includes("payments awaiting") || intent.includes("awaiting payment verification")) {
      const row=await e.DB.prepare("SELECT COUNT(*) AS total FROM contact_requests WHERE status='pending_payment' AND payment_reference IS NOT NULL").first<any>();
      return say(e,chat,"🧾 Payments awaiting manual Selar verification: <b>"+String(row?.total||0)+"</b>. A webhook match is not payment verification.");
    }
    if (intent.includes("latest matched sales") || intent.includes("matched sales")) {
      const rows=await e.DB.prepare("SELECT provider_reference,request_id,received_at FROM processed_sales WHERE request_id IS NOT NULL ORDER BY received_at DESC LIMIT 10").all<any>();
      const lines=(rows.results||[]).map((r:any)=>"• <code>"+esc(r.request_id)+"</code> · "+esc(r.received_at)+" · reference attached");
      return say(e,chat,"<b>Latest matched sales</b>\n"+(lines.join("\n")||"No matched sales recorded."));
    }
    if (intent.includes("service orders") || intent.includes("service orders waiting")) {
      const rows=await e.DB.prepare("SELECT id,service_id,status,checkout_code,payment_reference FROM service_orders WHERE status IN ('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 15").all<any>();
      const lines=(rows.results||[]).map((r:any)=>"• <code>"+esc(r.checkout_code||r.id)+"</code> · "+esc(r.service_id)+" · "+esc(r.status));
      return say(e,chat,"<b>🧾 Service orders needing attention</b>\n"+(lines.join("\n")||"No service orders awaiting review."));
    }
    if (intent.includes("today") && (intent.includes("summary") || intent.includes("requests") || intent.includes("statistics"))) {
      const row=await e.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='pending_payment' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='payment_verified' THEN 1 ELSE 0 END) AS verified,SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved FROM contact_requests WHERE date(created_at)=date('now')").first<any>();
      return say(e,chat,"<b>📊 Today’s contact request summary</b>\nCreated: "+String(row?.total||0)+"\nAwaiting payment/manual verification: "+String(row?.pending||0)+"\nPayment verified, awaiting approval: "+String(row?.verified||0)+"\nApproved: "+String(row?.approved||0));
    }
    const deliveryCode=t.match(/\bFL-[A-Z0-9]{6}\b/i);
    if(deliveryCode && (intent.includes("deliver") || intent.includes("fulfil") || intent.includes("fulfill"))) {
      const row=await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE checkout_code=?").bind(deliveryCode[0].toUpperCase()).first<any>();
      if(!row) return say(e,chat,"No contact request found for <code>"+esc(deliveryCode[0].toUpperCase())+"</code>.");
      if(row.status!=="payment_verified") return say(e,chat,"Request <code>"+esc(row.checkout_code)+"</code> is currently <b>"+esc(row.status)+"</b>. Delivery preparation requires manual payment verification first.");
      return say(e,chat,"📝 <b>Prepare delivery</b>\nRequest: <code>"+esc(row.id)+"</code>\nCode: <code>"+esc(row.checkout_code)+"</code>\nProfile: "+esc(row.profile_id)+"\n\nTap below to open the delivery draft. No customer message is sent until you preview and confirm.",{inline_keyboard:[[ {text:"📝 Prepare delivery",callback_data:"approve:"+row.id} ]]});
    }
    const codeMatch=t.match(/\bFL-[A-Z0-9]{6}\b/i);
    if (codeMatch && (intent.includes("find") || intent.includes("request") || intent.includes("status"))) {
      const row=await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE checkout_code=?").bind(codeMatch[0].toUpperCase()).first<any>();
      if (!row) return say(e,chat,"No contact request found for <code>"+esc(codeMatch[0].toUpperCase())+"</code>.");
      return say(e,chat,"<b>Contact request</b>\nID: <code>"+esc(row.id)+"</code>\nCode: <code>"+esc(row.checkout_code)+"</code>\nProfile: "+esc(row.profile_id)+"\nStatus: "+esc(row.status)+"\nSale reference: "+(row.payment_reference?"attached":"not attached"));
    }
  }
  return aiReply(e, chat, t, "", voiceReply);
}
async function createPendingAdminAction(e: Env, actor: string, action: "hide_profile" | "close_pending_orders", payload: string | null): Promise<string | null> {
  const current = await e.DB.prepare("SELECT id FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' LIMIT 1").bind(actor).first<any>();
  if (current) return null;
  const id = crypto.randomUUID();
  await e.DB.prepare("INSERT INTO admin_pending_actions(id,admin_telegram_id,action,payload,status,expires_at) VALUES(?,?,?,?,'pending',datetime('now','+10 minutes'))").bind(id, actor, action, payload).run();
  return id;
}
async function confirmPendingAdminAction(e: Env, actor: string, chat: string | number, id: string): Promise<boolean> {
  const action = await e.DB.prepare("SELECT id,admin_telegram_id,action,payload,status,expires_at FROM admin_pending_actions WHERE id=?").bind(id).first<any>();
  if (!action || String(action.admin_telegram_id) !== actor || action.status !== "pending") {
    await say(e, chat, "That confirmation is no longer active. Nothing was changed.");
    return false;
  }
  if (Date.parse(String(action.expires_at).replace(" ", "T") + (String(action.expires_at).endsWith("Z") ? "" : "Z")) < Date.now()) {
    await e.DB.prepare("UPDATE admin_pending_actions SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(id).run();
    await say(e, chat, "That confirmation expired. Nothing was changed.");
    return false;
  }
  const claimed = await e.DB.prepare("UPDATE admin_pending_actions SET status='executing',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending' AND admin_telegram_id=?").bind(id, actor).run();
  if (!claimed.meta?.changes) { await say(e, chat, "That action is already being handled. Nothing was repeated."); return false; }
  try {
    if (action.action === "hide_profile") {
      const profileId = String(action.payload || "");
      if (!/^[A-Za-z0-9._-]{1,50}$/.test(profileId)) throw new Error("invalid_profile_id");
      await e.DB.prepare("INSERT OR IGNORE INTO hidden_profiles(profile_id,hidden_by_admin,reason) VALUES(?,?,?)").bind(profileId, actor, "Hidden by admin from Telegram Admin Desk").run();
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'profile_hidden',?,'Admin hid profile from public site listings and Telegram catalogue')").bind(actor, profileId).run();
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      await say(e, chat, "🗑️ Profile <code>" + esc(profileId) + "</code> is hidden from website listings and Telegram requests. Refresh the website to see the change; source files remain recoverable in GitHub.");
      return true;
    }
    if (action.action === "close_pending_orders") {
      const contacts = await e.DB.prepare("SELECT id,checkout_code,telegram_chat_id FROM contact_requests WHERE status IN ('awaiting_email','pending_payment','awaiting_bank_reference','pending_manual_payment')").all<any>();
      const services = await e.DB.prepare("SELECT id,checkout_code,telegram_chat_id FROM service_orders WHERE status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','payment_review')").all<any>();
      const c = await e.DB.prepare("UPDATE contact_requests SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('awaiting_email','pending_payment','awaiting_bank_reference','pending_manual_payment')").run();
      const sv = await e.DB.prepare("UPDATE service_orders SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','payment_review')").run();
      const customerChats = [...new Set([...(contacts.results || []), ...(services.results || [])].map((r:any) => String(r.telegram_chat_id)).filter(Boolean))];
      for (const customerChat of customerChats) await sayBestEffort(e, customerChat, "Your pending FansLeak order was closed by support. Reply here if you need help.");
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,details) VALUES(?,'admin_closed_pending_orders',?)").bind(actor, "Closed pending contact requests=" + Number(c.meta?.changes || 0) + ", service orders=" + Number(sv.meta?.changes || 0)).run();
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      await say(e, chat, "✅ Pending orders closed. Contact requests expired: <b>" + Number(c.meta?.changes || 0) + "</b>; service orders cancelled: <b>" + Number(sv.meta?.changes || 0) + "</b>. Customers were notified. Records were retained for audit; no payment was verified.");
      return true;
    }
    throw new Error("unsupported_admin_action");
  } catch (error) {
    await e.DB.prepare("UPDATE admin_pending_actions SET status='failed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
    await notifyAdminIfConfigured(e, "⚠️ Admin action failed. Reference: <code>" + esc(id) + "</code>. No success was reported; inspect the audit and database state before retrying.");
    console.error("Admin action failed", String(error));
    return false;
  }
}

async function executeBroadcast(e: Env, actor: string, chat: string | number, draft: AdminBroadcastDraft): Promise<boolean> {
  if (draft.status !== "draft") { await say(e, chat, "This broadcast is no longer editable. It will not be sent again."); return false; }
  if (Date.parse(draft.expires_at.replace(" ", "T") + (draft.expires_at.endsWith("Z") ? "" : "Z")) < Date.now()) {
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    await say(e, chat, "This broadcast draft expired. Nothing was sent."); return false;
  }
  if (!draft.message_text?.trim() && !draft.media_file_id) { await say(e, chat, "Add message text or attach media before confirming the broadcast."); return false; }
  const audience = await e.DB.prepare("SELECT telegram_chat_id FROM contact_requests WHERE status IN ('pending_payment','payment_verified','approved') UNION SELECT telegram_chat_id FROM service_orders WHERE status IN ('pending_payment','payment_verified','fulfilled')").all<any>();
  const recipients = [...new Set((audience.results || []).map((r:any) => String(r.telegram_chat_id)).filter(Boolean))].slice(0, 100);
  if (!recipients.length) { await say(e, chat, "There are no customers in the active/recent order audience. Nothing was sent."); return false; }
  const claimed = await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draft.id, actor).run();
  if (!claimed.meta?.changes) { await say(e, chat, "Broadcast state changed or is already being sent. Nothing was sent by this attempt."); return false; }
  let sent = 0, failed = 0;
  for (const recipient of recipients) {
    try {
      const body = String(draft.message_text || "");
      if (draft.media_file_id && draft.media_kind === "photo") await tg(e, "sendPhoto", { chat_id: recipient, photo: draft.media_file_id, ...(body ? { caption: body.slice(0, 900) } : {}) });
      else if (draft.media_file_id && draft.media_kind === "document" && /^video\//i.test(draft.media_mime_type || "")) await tg(e, "sendVideo", { chat_id: recipient, video: draft.media_file_id, ...(body ? { caption: body.slice(0, 900) } : {}) });
      else if (draft.media_file_id && draft.media_kind === "document") await tg(e, "sendDocument", { chat_id: recipient, document: draft.media_file_id, ...(body ? { caption: body.slice(0, 900) } : {}) });
      else await say(e, recipient, esc(body));
      sent++;
    } catch { failed++; }
  }
  const status = failed === 0 ? "sent" : "partial";
  await e.DB.prepare("UPDATE admin_broadcast_drafts SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(status, draft.id).run();
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,details) VALUES(?,?,?)").bind(actor, "admin_broadcast_" + status, "Broadcast draft " + draft.id + ": sent=" + sent + ", failed=" + failed + ", recipients=" + recipients.length).run();
  await say(e, chat, (failed ? "⚠️" : "✅") + " Broadcast finished. Sent: <b>" + sent + "</b>; failed: <b>" + failed + "</b>. The draft is locked against duplicate sends.");
  return failed === 0;
}

async function executeSupportDraft(e: Env, actor: string, chat: string | number, draftId: string): Promise<boolean> {
  const context = await loadAdminMessageDraftContext(e, draftId);
  if (!context || String(context.draft.admin_telegram_id) !== actor) { await say(e, chat, "Support draft not found for this admin."); return false; }
  const draft = context.draft, order = context.order;
  if (await expireAdminMessageDraftIfNeeded(e, draft)) { await say(e, chat, "Support draft expired. Nothing was sent."); return false; }
  if (draft.status !== "draft") { await say(e, chat, draft.status === "sending" ? "This support message is locked while its delivery outcome is checked." : "Support draft is no longer active."); return false; }
  if (!order || String(order.telegram_user_id) !== String(draft.telegram_user_id) || String(order.telegram_chat_id) !== String(draft.telegram_chat_id)) { await say(e, chat, "The selected order or customer destination changed. Nothing was sent."); return false; }
  const problem = adminMessageSendProblem(draft);
  if (problem) { await say(e, chat, problem); return false; }
  const orderTable = draft.order_kind === "contact" ? "contact_requests" : "service_orders";
  const claimed = await e.DB.prepare("UPDATE admin_message_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND message_text IS ? AND media_kind IS ? AND media_file_id IS ? AND media_mime_type IS ? AND EXISTS(SELECT 1 FROM " + orderTable + " o WHERE o.id=admin_message_drafts.order_id AND o.telegram_user_id=admin_message_drafts.telegram_user_id AND o.telegram_chat_id=admin_message_drafts.telegram_chat_id)")
    .bind(draftId, actor, draft.message_text || null, draft.media_kind || null, draft.media_file_id || null, draft.media_mime_type || null).run();
  if (!claimed.meta?.changes) { await say(e, chat, "Support draft changed, is already sending, or its destination no longer matches."); return false; }
  const body = adminMessageBody(draft);
  try {
    if (draft.media_file_id && draft.media_kind === "photo") await tg(e, "sendPhoto", { chat_id: draft.telegram_chat_id, photo: draft.media_file_id, ...(body ? { caption: adminMessageCaption(body), parse_mode: "HTML" } : {}) });
    else if (draft.media_file_id && draft.media_kind === "document") await tg(e, "sendDocument", { chat_id: draft.telegram_chat_id, document: draft.media_file_id, ...(body ? { caption: adminMessageCaption(body), parse_mode: "HTML" } : {}) });
    else await say(e, draft.telegram_chat_id, ADMIN_MESSAGE_HEADER + "\n\n" + esc(body));
  } catch {
    try { await auditAdminMessageDraft(e, actor, "admin_support_message_uncertain", draft, order, "Telegram support-message outcome uncertain for " + draft.order_kind + " order " + String(order.checkout_code || draft.checkout_code || draft.order_id) + "; draft locked as sending; " + adminMessageContentDetails(draft)); } catch {}
    try { await notifyAdminIfConfigured(e, "⚠️ Customer support message outcome is uncertain for " + draft.order_kind + " order <code>" + esc(String(order.checkout_code || draft.checkout_code || draft.order_id)) + "</code>. The draft remains locked to prevent duplicates. Inspect the customer conversation before any retry."); } catch {}
    await say(e, chat, "⚠️ Message outcome uncertain. The draft is locked to prevent duplicate sends; inspect the customer conversation before retrying.");
    return false;
  }
  const sent = await e.DB.prepare("UPDATE admin_message_drafts SET status='sent',delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
  await auditAdminMessageDraft(e, actor, "admin_message_customer", draft, order, "Admin sent customer support message for " + draft.order_kind + " order " + String(order.checkout_code || draft.checkout_code || draft.order_id) + "; " + adminMessageContentDetails(draft));
  if (!sent.meta?.changes) await notifyAdminIfConfigured(e, "A customer support message was sent for <code>" + esc(String(order.checkout_code || draft.order_id)) + "</code>, but the draft status changed concurrently. Inspect the audit before any retry.");
  await say(e, chat, "✅ Support message sent for order <code>" + esc(String(order.checkout_code || order.id)) + "</code>.");
  return true;
}

async function callback(e: Env, u: NonNullable<Update["callback_query"]>) {
  const actor = String(u.from.id), data = u.data || "", chat = u.message?.chat.id;
  if (data.startsWith("admin-action:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
    const match = data.match(/^admin-action:(confirm|cancel):([0-9a-f-]{36})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid admin action." });
    if (match[1].toLowerCase() === "cancel") {
      const cancelled = await e.DB.prepare("UPDATE admin_pending_actions SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND admin_telegram_id=? AND status='pending'").bind(match[2], actor).run();
      await say(e, chat, cancelled.meta?.changes ? "Action cancelled. Nothing was changed." : "That action is no longer pending.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Cancellation processed." });
    }
    await confirmPendingAdminAction(e, actor, chat, match[2]);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin action processed." });
  }
  if (data.startsWith("profiledelete:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
    const match = data.match(/^profiledelete:(confirm|cancel):([A-Za-z0-9._-]{1,50})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid profile action." });
    const action = match[1].toLowerCase(), profileId = match[2];
    if (action === "cancel") {
      await say(e, chat, "Profile removal cancelled. The website was not changed.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Cancelled." });
    }
    const cat = await catalogue(e);
    const profile = cat.find(p => p.id === profileId);
    if (!profile) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Profile is already hidden or unavailable." });
    await e.DB.prepare("INSERT OR IGNORE INTO hidden_profiles(profile_id,hidden_by_admin,reason) VALUES(?,?,?)").bind(profileId, actor, "Hidden by admin from Telegram Admin Desk").run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'profile_hidden',?,'Admin hid profile from public site listings and Telegram catalogue')").bind(actor, profileId).run();
    await say(e, chat, "🗑️ Profile <b>" + esc(profile.name) + "</b> is now hidden from the website listings and Telegram request catalogue. Refresh the website to see the change. The source files remain recoverable in GitHub.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Profile hidden." });
  }
  if (data.startsWith("broadcast:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
    const match = data.match(/^broadcast:(preview|send|cancel):([0-9a-f-]{36})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid broadcast action." });
    const action = match[1].toLowerCase(), id = match[2];
    const draft = await e.DB.prepare("SELECT id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at FROM admin_broadcast_drafts WHERE id=?").bind(id).first<AdminBroadcastDraft>();
    if (!draft || draft.admin_telegram_id !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast draft not found." });
    if (draft.status !== "draft") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast draft is no longer editable." });
    if (Date.parse(draft.expires_at.replace(" ", "T") + (draft.expires_at.endsWith("Z") ? "" : "Z")) < Date.now()) {
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(id).run();
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast draft expired." });
    }
    if (action === "cancel") {
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(id).run();
      await say(e, chat, "✖️ Broadcast cancelled. Nothing was sent.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast cancelled." });
    }
    const audience = await e.DB.prepare("SELECT telegram_chat_id FROM contact_requests WHERE status IN ('pending_payment','payment_verified','approved') UNION SELECT telegram_chat_id FROM service_orders WHERE status IN ('pending_payment','payment_verified','fulfilled')").all<any>();
    const recipients = [...new Set((audience.results || []).map((r:any) => String(r.telegram_chat_id)).filter(Boolean))].slice(0, 100);
    if (action === "preview") {
      await say(e, chat, "👀 <b>Broadcast preview</b>\nRecipients: " + recipients.length + " (maximum 100 per broadcast)\nMessage: " + (draft.message_text ? esc(draft.message_text) : "—") + "\nMedia: " + (draft.media_kind ? esc(draft.media_mime_type || draft.media_kind) : "none") + "\n\nNo messages sent.", { inline_keyboard: [[{ text: "✅ Confirm and send", callback_data: "broadcast:send:" + id }], [{ text: "✖️ Cancel", callback_data: "broadcast:cancel:" + id }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Preview only." });
    }
    await executeBroadcast(e, actor, chat, draft);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast action processed." });
  }
  if (data.startsWith("draft:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Admin access only."});
    const dm = data.match(/^draft:(preview|send|cancel):([0-9a-f-]{36})$/i);
    if (!dm) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Unknown draft action."});
    const draftAction=dm[1].toLowerCase(), draftId=dm[2];
    const d=await e.DB.prepare("SELECT d.id,d.request_id,d.admin_telegram_id,d.checkout_code,d.message_text,d.media_kind,d.media_file_id,d.status,d.expires_at,r.telegram_chat_id,r.profile_id,r.status AS request_status,c.contact_value FROM delivery_drafts d JOIN contact_requests r ON r.id=d.request_id LEFT JOIN creator_contacts c ON c.profile_id=r.profile_id WHERE d.id=?").bind(draftId).first<any>();
    if (!d || String(d.admin_telegram_id)!==actor) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft not found for this admin."});
    if (draftAction==="cancel") {
      if(d.status!=="draft") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Only an unsent draft can be cancelled."});
      await e.DB.prepare("UPDATE delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(? ,'delivery_draft_cancelled',?,?,?)").bind(actor,d.request_id,d.profile_id,"Admin cancelled unsent draft").run();
      await say(e,chat,"✖️ Draft cancelled. Nothing was sent.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft cancelled."});
    }
    if(d.status!=="draft" || !d.expires_at || Date.parse(String(d.expires_at).replace(" ","T")+"Z")<Date.now()) {
      if(d.status==="draft") await e.DB.prepare("UPDATE delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft expired or is no longer active."});
    }
    if(d.request_status!=="payment_verified") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Payment or request state changed. Nothing was sent."});
    if(!String(d.contact_value||"").trim()) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"No contact is saved for this profile. Use /setcontact PROFILE_ID @handle before preparing delivery."});
    const body=String(d.message_text||"").trim();
    if(draftAction==="preview") {
      const preview="👀 <b>Delivery preview</b>\nRequest: <code>"+d.request_id+"</code>\nCheckout code: <code>"+esc(d.checkout_code||"")+"</code>\nProfile: <code>"+esc(d.profile_id)+"</code>\n\n🎉 Congratulations! Your payment has been verified and your request approved.\n\n"+(body?esc(body):"<i>No custom message added.</i>")+"\n\nCreator contact: <b>"+esc(d.contact_value)+"</b>\n\n"+(d.media_kind?"📎 One "+esc(d.media_kind)+" attached.":"No media attached.")+"\n\n<i>Preview only — nothing has been sent.</i>";
      return say(e,chat,preview,{inline_keyboard:[[ {text:"✅ Send to customer",callback_data:"draft:send:"+draftId},{text:"✖️ Cancel",callback_data:"draft:cancel:"+draftId} ]]});
    }
    if(!body && !d.media_file_id) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Add a message or media before sending."});
    const claimed=await e.DB.prepare("UPDATE delivery_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND EXISTS (SELECT 1 FROM contact_requests r JOIN creator_contacts c ON c.profile_id=r.profile_id WHERE r.id=delivery_drafts.request_id AND r.status='payment_verified' AND c.contact_value=?)").bind(draftId,actor,d.contact_value).run();
    if(!claimed.meta?.changes) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft is already sending or inactive."});
    const deliveryText="🎉 <b>Congratulations!</b> Your payment has been verified and your request approved.\n\n"+(body?esc(body)+"\n\n":"")+"Creator contact: <b>"+esc(d.contact_value)+"</b>\n\nPlease respect the creator boundaries.";
    try {
      if(d.media_file_id && d.media_kind==="photo") await tg(e,"sendPhoto",{chat_id:d.telegram_chat_id,photo:d.media_file_id,caption:deliveryText,parse_mode:"HTML"});
      else if(d.media_file_id && d.media_kind==="document") await tg(e,"sendDocument",{chat_id:d.telegram_chat_id,document:d.media_file_id,caption:deliveryText,parse_mode:"HTML"});
      else await say(e,d.telegram_chat_id,deliveryText);
    } catch {
      await notifyAdminIfConfigured(e,"⚠️ Delivery outcome is uncertain for request <code>"+d.request_id+"</code> / code <code>"+esc(d.checkout_code||"")+"</code>. Draft remains locked as sending to prevent duplicate disclosure. Inspect Telegram before any manual retry.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery outcome uncertain. Draft locked to prevent duplicates."});
    }
    const finalStatus=await e.DB.prepare("UPDATE contact_requests SET status='approved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(d.request_id).run();
    await e.DB.prepare("UPDATE delivery_drafts SET status='sent',delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(? ,'delivery_sent',?,?,?)").bind(actor,d.request_id,d.profile_id,"Confirmed delivery draft sent through Telegram").run();
    if(!finalStatus.meta?.changes) await notifyAdminIfConfigured(e,"Delivery sent for request <code>"+d.request_id+"</code>, but status changed concurrently. Inspect audit before retrying.");
    return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery sent once and recorded."});
  }
  if (data.startsWith("service-delivery:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Admin access only."});
    const match=data.match(/^service-delivery:(send|cancel):([0-9a-f-]{36})$/i);
    if(!match) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Unknown service delivery action."});
    const action=match[1].toLowerCase(), draftId=match[2];
    const d=await e.DB.prepare("SELECT d.id,d.service_order_id,d.admin_telegram_id,d.message_text,d.status,d.expires_at,o.telegram_chat_id,o.status AS order_status,o.checkout_code FROM service_delivery_drafts d JOIN service_orders o ON o.id=d.service_order_id WHERE d.id=?").bind(draftId).first<any>();
    if(!d || String(d.admin_telegram_id)!==actor) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft not found for this admin."});
    if(action==="cancel") {
      if(d.status!=="draft") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Only an unsent draft can be cancelled."});
      const cancelled=await e.DB.prepare("UPDATE service_delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId,actor).run();
      if(!cancelled.meta?.changes) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft state changed; nothing was sent."});
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_delivery_draft_cancelled',?,?)").bind(actor,d.service_order_id,"Admin cancelled unsent fulfilment draft").run();
      await say(e,chat,"✖️ Service fulfilment draft cancelled. Nothing was sent.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft cancelled."});
    }
    if(d.status!=="draft" || !d.expires_at || Date.parse(String(d.expires_at).replace(" ","T")+"Z")<Date.now()) {
      if(d.status==="draft") await e.DB.prepare("UPDATE service_delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft expired or is no longer active."});
    }
    if(d.order_status!=="payment_verified") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Order is no longer awaiting fulfilment. Nothing was sent."});
    const claimed=await e.DB.prepare("UPDATE service_delivery_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND EXISTS(SELECT 1 FROM service_orders o WHERE o.id=service_delivery_drafts.service_order_id AND o.status='payment_verified')").bind(draftId,actor).run();
    if(!claimed.meta?.changes) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft is already sending or inactive."});
    try {
      await tg(e,"sendMessage",{chat_id:d.telegram_chat_id,text:"Your service order is ready. Details from the provider:\n\n"+String(d.message_text),disable_web_page_preview:true});
    } catch {
      await notifyAdminIfConfigured(e,"⚠️ Service fulfilment outcome is uncertain for order <code>"+esc(d.service_order_id)+"</code>. Draft remains locked to prevent duplicate delivery. Inspect Telegram before any retry.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery outcome uncertain. Draft locked to prevent duplicates."});
    }
    const fulfilled=await e.DB.prepare("UPDATE service_orders SET status='fulfilled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(d.service_order_id).run();
    await e.DB.prepare("UPDATE service_delivery_drafts SET status='sent',delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_order_fulfilled',?,?)").bind(actor,d.service_order_id,"Admin confirmed and sent service fulfilment").run();
    if(!fulfilled.meta?.changes) await notifyAdminIfConfigured(e,"Service fulfilment was sent but order status changed concurrently. Inspect audit before retrying: <code>"+esc(d.service_order_id)+"</code>");
    await say(e,chat,"Fulfilment sent to customer for order <code>"+esc(String(d.checkout_code||d.service_order_id))+"</code>.");
    return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Fulfilment sent once and recorded."});
  }
  if (data.startsWith("support-message:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin access only in the private Admin Desk chat." });
    }
    const match = data.match(/^support-message:(preview|send|cancel):([0-9a-f-]{36})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown support draft action." });
    const action = match[1].toLowerCase(), draftId = match[2];
    const context = await loadAdminMessageDraftContext(e, draftId);
    if (!context || String(context.draft.admin_telegram_id) !== actor) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft not found for this admin." });
    }
    const draft = context.draft, order = context.order;

    if (await expireAdminMessageDraftIfNeeded(e, draft)) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft expired. Nothing was sent." });
    }

    if (action === "cancel") {
      if (draft.status !== "draft") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Only an unsent support draft can be cancelled." });
      const cancelled = await e.DB.prepare("UPDATE admin_message_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId, actor).run();
      if (!cancelled.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft state changed; nothing was sent." });
      await auditAdminMessageDraft(e, actor, "admin_support_draft_cancelled", draft, order, "Admin cancelled unsent customer support draft for " + draft.order_kind + " order " + String(order?.checkout_code || draft.checkout_code || draft.order_id) + "; " + adminMessageContentDetails(draft));
      await say(e, chat, "✖️ Customer support draft cancelled. Nothing was sent.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft cancelled." });
    }

    if (draft.status !== "draft") {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: draft.status === "sending" ? "This support message is locked because its Telegram outcome needs review." : "Support draft is no longer active." });
    }
    if (!order || String(order.telegram_user_id) !== String(draft.telegram_user_id) || String(order.telegram_chat_id) !== String(draft.telegram_chat_id)) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "The selected order or customer destination changed. Nothing was sent." });
    }

    if (action === "preview") {
      await sendAdminMessageDraftSummary(e, chat, draft, order, { heading: "👀 <b>Customer support preview</b>", includeMediaPreview: true });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Preview only — nothing has been sent." });
    }

    await executeSupportDraft(e, actor, chat, draftId);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support send action processed." });
  }
  if (data.startsWith("done:") || data.startsWith("paid:")) {
    if (!u.message || String(u.message.chat.id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Open the bot chat to continue." });
    const id = data.slice(data.indexOf(":") + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid order reference." });
    const order = await loadCustomerOrderById(e, id);
    if (!order || String(order.telegram_user_id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This order is not available for this Telegram account." });
    const outcome = await handlePaidClaim(e, actor, actor, order);
    const callbackText = outcome === "name_needed"
      ? "Send your checkout name and code."
      : outcome === "sale_found"
        ? "Sale record found. Manual verification is still required."
        : outcome === "receipt_needed"
          ? "No sale record found. Send your Selar receipt."
          : outcome === "receipt_already_forwarded"
            ? "Your receipt is already with the administrator."
            : outcome === "verified"
              ? "Payment has already been manually verified."
              : "Payment check complete.";
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: callbackText });
  }
  if (data.startsWith("pay_")) {
    if (!u.message || String(u.message.chat.id) !== actor) {
      await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Open the bot chat to choose a payment method." }); return;
    }
    const m = data.match(/^pay_selar:([0-9a-f-]{36})$/i);
    if (!m) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid payment choice." });
    const method = "selar", id = m[1];
    const r = await e.DB.prepare("SELECT id,status,telegram_user_id,telegram_chat_id,checkout_code FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!r || String(r.telegram_user_id) !== actor || r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This request is no longer waiting for payment." });
    if (!enabledMethods(e).includes(method)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "That payment method is not configured." });
    if (method === "selar") {
      const checkout = new URL(e.SELAR_CHECKOUT_URL as string);
      checkout.searchParams.set("add_to_cart", "1");
      await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
      const markup = {
        inline_keyboard: [
          [{ text: "Open Selar Checkout ↗️", url: checkout.toString() }],
          [{ text: "✅ Done — checkout completed", callback_data: `done:${id}` }],
          [{ text: "🔎 I've paid — check again", callback_data: `paid:${id}` }]
        ]
      };
      await say(e, r.telegram_chat_id, `Open the Selar checkout here: ${checkout.toString()}\n\nIn the customer name field, enter your full name followed by this code exactly: <code>${esc(r.checkout_code || "")}</code>\nExample: <code>Joseph Unaogu ${esc(r.checkout_code || "FL-7K4P9A")}</code>\n\nAfter paying, return here and tap Done or “I've paid” below. The bot first checks for an existing backend sale record; only if none is attached will it ask you to forward your Selar receipt for manual review.\n\nThe admin checks payment manually; this does not confirm payment immediately. If matching later needs help, send your email as a fallback clue.`, markup);
    }
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Selar checkout instructions sent." }); return;
  }
  if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) {
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Not authorised." }); return;
  }
  if (data.startsWith("admin:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin access only." });
    const action = data.slice("admin:".length);
    if (action === "pending") {
      const rows = await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 12").all<any>();
      const buttons = (rows.results || []).map(r => [{ text: (r.status === "payment_verified" ? "🟢 Paid — review approval" : "🟡 Check payment") + " · " + String(r.checkout_code || "request"), callback_data: "admin:request:" + r.id }]);
      await say(e, chat, "<b>Contact requests needing attention</b>\nChoose a request to review its saved status. A sale notification is not payment verification.", { inline_keyboard: [...buttons, [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Contact requests loaded." });
    }
    if (action === "orders") {
      const rows = await e.DB.prepare("SELECT id,service_id,status,checkout_code,payment_reference FROM service_orders ORDER BY created_at DESC LIMIT 12").all<any>();
      const lines = (rows.results || []).map(r => "• <code>" + esc(r.checkout_code || r.id) + "</code> — " + esc(r.service_id || "service") + " — " + esc(r.status) + " — " + (r.payment_reference ? "sale reference attached" : "no sale reference"));
      await say(e, chat, "<b>Recent service orders</b>\n" + (lines.join("\n") || "No service orders found.") + "\n\nUse the customer-message option in Admin Desk to contact a customer.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service orders loaded." });
    }
    if (action === "message_help") {
      await say(e, chat, "<b>Message a customer</b>\nUse their FL- order code or full order UUID to open a private, expiring support draft. You can include text immediately or add it next; you may also attach one Telegram photo or PDF/image document.\n\nExamples:\n<code>/message FL-ABC123 Hi, I’m checking your request and will update you here.</code>\n<code>/message FL-ABC123</code> — then send the text and/or attachment.\n\nNothing is sent while composing. Review the preview, then tap <b>Send to customer</b> or <b>Cancel</b>. This does not change payment, approval, consent, delivery, or fulfilment status.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Customer-message instructions opened." });
    }
    if (action === "help") {
      await say(e, chat, "<b>Admin guide</b>\n• Review the real sale in Selar before confirming payment.\n• Payment confirmation and contact approval are separate actions.\n• Contact delivery requires a saved contact and a manually verified payment.\n• Use /message ORDER_CODE_OR_UUID to open a customer support draft; nothing sends until you preview and confirm.\n• Use /help for all supported commands.\n• AI replies cannot verify payments or approve contact delivery.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin guide opened." });
    }
    if (action === "home") {
      await say(e, chat, "<b>FansLeak Admin Desk</b>\nChoose an action:", { inline_keyboard: [[{ text: "📥 Review contact requests", callback_data: "admin:pending" }], [{ text: "🧾 Review service orders", callback_data: "admin:orders" }], [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }], [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin menu." });
    }
    const requestMatch = action.match(/^request:([0-9a-f-]{36})$/i);
    if (requestMatch) {
      const r = await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE id=?").bind(requestMatch[1]).first<any>();
      if (!r) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request not found." });
      const actions: Record<string, unknown>[][] = [];
      if (r.status === "pending_payment" && r.payment_reference) actions.push([{ text: "✅ I checked Selar — confirm payment", callback_data: "selarverify:" + r.id }]);
      if (r.status === "payment_verified") actions.push([{ text: "🔓 Prepare delivery", callback_data: "approve:" + r.id }, { text: "❌ Reject request", callback_data: "reject:" + r.id }]);
      actions.push([{ text: "💬 How to message this customer", callback_data: "admin:message_help" }], [{ text: "↩️ Back to requests", callback_data: "admin:pending" }], [{ text: "🏠 Admin Desk", callback_data: "admin:home" }]);
      await say(e, chat, "<b>Contact request details</b>\nCode: <code>" + esc(r.checkout_code || "") + "</code>\nProfile: " + esc(r.profile_id || "unknown") + "\nStatus: <b>" + esc(r.status) + "</b>\nSale reference: " + (r.payment_reference ? "<code>" + esc(r.payment_reference) + "</code>" : "none attached") + "\n\nUse payment confirmation only after checking the real sale in Selar. Approval remains separate and requires creator consent.", { inline_keyboard: actions });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request details opened." });
    }
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown admin menu action." });
  }
  // All payment-verification, approval, and rejection callbacks are admin-only.
  if (actor !== e.ADMIN_TELEGRAM_ID) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin access only." });
  const m = data.match(/^(approve|reject|selarverify|serviceverify):([0-9a-f-]{36})$/i);
  if (!m) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown action." }); return; }
  const action = m[1].toLowerCase(), id = m[2];
  if (action === "serviceverify") {
    const service = await e.DB.prepare("SELECT id,telegram_chat_id,status,payment_method,payment_reference FROM service_orders WHERE id=?").bind(id).first<any>();
    if (!service || service.status !== "pending_payment" || service.payment_method !== "selar" || !service.payment_reference) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No service payment notification is attached." });
    const updateRes = await e.DB.prepare("UPDATE service_orders SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
    if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service payment was already verified." });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_payment_admin_verified',?,?)").bind(actor, id, `Admin manually confirmed Selar payment; reference ${service.payment_reference}`).run();
    await sayBestEffort(e, service.telegram_chat_id, "The admin has manually confirmed your payment. Your service order is awaiting fulfilment.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Payment manually confirmed for service order <code>" + id + "</code>. Use /deliver " + id + " your service details when ready.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment confirmed by your admin action." });
  }
  const r = await e.DB.prepare("SELECT id,telegram_chat_id,profile_id,status FROM contact_requests WHERE id=?").bind(id).first<RequestRow>();
  if (!r) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request not found." }); return; }
  if (action === "selarverify") {
    if (r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is not awaiting Selar verification." });
    const paid = await e.DB.prepare("SELECT payment_reference,payment_method FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!paid || paid.payment_method !== "selar" || !paid.payment_reference) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No Selar sale notification is attached. Check Selar logs and match manually." });
    const updateRes = await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(id).run();
    if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment was already verified." });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'selar_payment_admin_verified',?,?,?)").bind(actor, id, r.profile_id, `Admin reviewed webhook-backed Selar payment before approving; reference ${paid.payment_reference}`).run();
    await sayBestEffort(e, r.telegram_chat_id, "The admin reviewed your Selar payment notification. Your request is now waiting for final approval.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Next, prepare delivery for this exact customer. Contact release still requires confirmed creator consent.", { inline_keyboard: [[{ text: "🔓 Prepare delivery", callback_data: "approve:" + id }, { text: "Reject", callback_data: "reject:" + id }]] });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment verified. Review the contact request next." });
  }
  if (action === "reject") {
    if (!["pending_payment", "payment_verified"].includes(r.status)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is no longer pending." });
    const updateRes = await e.DB.prepare("UPDATE contact_requests SET status='rejected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('pending_payment','payment_verified')").bind(id).run();
    if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request status already changed." });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'reject_request',?,?)").bind(actor, id, r.profile_id).run();
    await say(e, r.telegram_chat_id, "Your request was rejected. If you paid, contact support about a refund; refunds must be handled through the payment provider or your bank.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Rejected." });
  }
  if (r.status !== "payment_verified") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment is not verified." });
  const c = await e.DB.prepare("SELECT contact_value FROM creator_contacts WHERE profile_id=?").bind(r.profile_id).first<any>();
  if (!c || !String(c.contact_value || "").trim()) {
    await notifyAdminIfConfigured(e, "Cannot prepare delivery for request <code>" + id + "</code>: no contact is saved for <code>" + esc(r.profile_id) + "</code>. Use /setcontact PROFILE_ID @handle to add the fulfilment contact. No contact was sent.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No contact is saved for this profile." });
  }
  const otherDraft = await e.DB.prepare("SELECT id,checkout_code FROM delivery_drafts WHERE admin_telegram_id=? AND status='draft' AND request_id<>? ORDER BY updated_at DESC LIMIT 1").bind(actor,id).first<any>();
  if (otherDraft) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Finish or cancel the existing contact delivery draft (code " + String(otherDraft.checkout_code || "unknown") + ") before preparing another." });
  const supportDraft = await activeAdminMessageDraft(e, actor);
  if (supportDraft) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Finish or cancel the customer support draft (code " + String(supportDraft.checkout_code || supportDraft.order_id) + ") before preparing contact delivery." });
  const oldDraft = await e.DB.prepare("SELECT id,status FROM delivery_drafts WHERE request_id=?").bind(id).first<any>();
  if (oldDraft && (oldDraft.status === "sent" || oldDraft.status === "sending")) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Delivery already sent or its outcome needs review." });
  const draftId = oldDraft?.id || crypto.randomUUID();
  if (oldDraft) {
    await e.DB.prepare("UPDATE delivery_drafts SET status='draft',admin_telegram_id=?,message_text=NULL,media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),expires_at=datetime('now','+30 minutes') WHERE id=? AND status IN('draft','cancelled','expired')").bind(actor,draftId).run();
  } else {
    await e.DB.prepare("INSERT INTO delivery_drafts(id,request_id,admin_telegram_id,checkout_code,status,expires_at) SELECT ?,id,?,checkout_code,'draft',datetime('now','+30 minutes') FROM contact_requests WHERE id=? AND status='payment_verified'").bind(draftId,actor,id).run();
  }
  const draft = await e.DB.prepare("SELECT id,checkout_code FROM delivery_drafts WHERE id=? AND admin_telegram_id=? AND status='draft'").bind(draftId,actor).first<any>();
  if (!draft) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Could not create a draft. Request state may have changed."});
  await say(e,chat,"📝 <b>Delivery draft</b>\nRequest: <code>"+id+"</code>\nCheckout code: <code>"+esc(draft.checkout_code || "unknown")+"</code>\nProfile: <code>"+esc(r.profile_id)+"</code>\n\nSend the message you want the customer to receive (up to 700 characters). You may attach one photo or document. Then preview and confirm.\n\nExpires in 30 minutes. Nothing has been sent.",{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+draftId} ],[ {text:"✖️ Cancel",callback_data:"draft:cancel:"+draftId} ]]});
  return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft opened. No customer message sent."});
}
type Sale = { reference: string; email: string; customerName: string; productId: string };
function selarProductCode(o: Record<string, any>): string {
  const raw = [o.product_code, o.productCode, o.all_product_codes, o.allProductCodes]
    .find(value => typeof value === "string" && value.trim());
  if (typeof raw !== "string") return "";
  const codes = [...new Set(raw.split(/[,;\n]+/).map(value => value.trim()).filter(Boolean))];
  return codes.length === 1 ? codes[0] : "";
}
function normalise(body: unknown): Sale | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, any>;
  const reference = String(o.reference ?? o.transaction_reference ?? o.transactionReference ?? o.sale_reference ?? o.saleReference ?? o.receipt_url ?? o.receiptUrl ?? "").trim();
  const email = String(o.email ?? o.buyer_email ?? o.customer_email ?? o.customerEmail ?? o.customer?.email ?? "").trim().toLowerCase();
  const customerName = String(o.customer_full_name ?? o.buyer_full_name ?? o.customer_name ?? o.full_name ?? o.fullName ?? o.name ?? o.customer?.name ?? "").trim();
  const productId = selarProductCode(o);
  if (!reference || reference.length > 512 || !customerName || customerName.length > 300 || email.length > 254 || !productId || productId.length > 128) return null;
  return { reference, email, customerName, productId };
}
function nonPaidStatus(body: unknown): string {
  // Only reject when the sender explicitly reports a non-paid state. Payloads that
  // carry no status field keep the established behaviour (still admin-verified only).
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, any>;
  const raw = String(o.status ?? o.payment_status ?? o.event ?? o.event_type ?? o.type ?? "").trim().toLowerCase();
  if (!raw) return "";
  return /(fail|refund|chargeback|cancel|pending|unpaid|declin|abandon)/.test(raw) ? raw : "";
}

async function selar(request: Request, e: Env) {
  if (provider(e) !== "selar" || !methods(e).includes("selar")) return json({ error: "selar_is_not_enabled" }, 409);
  if (!e.SELAR_WEBHOOK_SECRET || !safeEq(request.headers.get("x-selar-webhook-secret") || "", e.SELAR_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
  if (!e.ADMIN_TELEGRAM_ID) return json({ error: "admin_not_configured" }, 503);
  const parsed = await readJsonBody(request, 65536);
  if (!parsed.ok) return json({ error: parsed.error || "invalid_json" }, parsed.status || 400);
  const body: unknown = parsed.value;
  const s = normalise(body);
  if (!s) return json({ error: "invalid_sale_payload", expected: ["reference", "customer_full_name", "product_code"] }, 400);
  const badStatus = nonPaidStatus(body);
  if (badStatus) {
    await notifyAdminIfConfigured(e, `<b>Selar event ignored: reported as not paid</b>\nReference: <code>${esc(s.reference)}</code>\nReported status/event: ${esc(badStatus)}\nNo order was changed and no payment was verified.`);
    return json({ error: "unsupported_event" }, 422);
  }
  const kind: "contact" | "service" | null = s.productId === e.SELAR_PRODUCT_ID ? "contact" : s.productId === e.SERVICE_PRODUCT_ID ? "service" : null;
  if (!kind) {
    await notifyAdminIfConfigured(e, `<b>Selar sale was for the wrong configured product</b>\nReference: <code>${esc(s.reference)}</code>\nCustomer name: ${esc(s.customerName)}\nProduct ID: ${esc(s.productId)}${s.email ? `\nEmail: ${esc(s.email)}` : "\nEmail: not supplied"}\nNo payment was verified automatically.`);
    return json({ error: "wrong_product" }, 422);
  }
  if (await e.DB.prepare("SELECT provider_reference FROM processed_sales WHERE provider_reference=?").bind(s.reference).first()) return json({ ok: true, duplicate: true });

  const code = codeInName(s.customerName);
  let target: any = null;
  let matchedBy: "unique_code" | "exact_full_name" | "email_fallback" | null = null;

  // Match strongest evidence first: unique checkout code, then exact full name.
  // Email is a last-resort reconciliation clue only and never verifies payment.
  if (code) {
    const codeRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
    if (codeRows.results.length === 1) {
      target = codeRows.results[0];
      matchedBy = "unique_code";
    }
  }

  if (!target) {
    const saleName = s.customerName.replace(new RegExp("\\s*" + (code || "") + "\\s*$", "i"), "").trim();
    const fullName = normName(saleName);
    if (fullName.length >= 5 && fullName.includes(" ")) {
      const nameRows = kind === "contact"
        ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE status='pending_payment' AND payment_method='selar' AND checkout_name IS NOT NULL").all<any>()
        : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE status='pending_payment' AND checkout_name IS NOT NULL").all<any>();
      const exactNameRows = nameRows.results.filter((row: any) => row.checkout_name && normName(row.checkout_name) === fullName);
      if (exactNameRows.length === 1) {
        target = exactNameRows[0];
        matchedBy = "exact_full_name";
      }
    }
  }

  if (!target && s.email && emailRe.test(s.email)) {
    const email = s.email.trim().toLowerCase();
    const emailRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE status='pending_payment' AND payment_method='selar' AND buyer_email IS NOT NULL").all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE status='pending_payment' AND buyer_email IS NOT NULL").all<any>();
    const exactEmailRows = emailRows.results.filter((row: any) => String(row.buyer_email || "").trim().toLowerCase() === email);
    if (exactEmailRows.length === 1) {
      target = exactEmailRows[0];
      matchedBy = "email_fallback";
    } else {
      return json({ ok: true, matched: false, reason: exactEmailRows.length > 1 ? "ambiguous_email_fallback" : "no_unique_code_name_or_email_match" });
    }
  }

  if (!target) return json({ ok: true, matched: false, reason: "no_unique_code_name_or_email_match" });

  const saleInserted = await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email || target.buyer_email || "", 0, "UNK", s.productId, target.id).run();
  if (saleInserted.meta?.changes === 0) return json({ ok: true, duplicate: true });

  const effectiveCode = target.checkout_code || code || "unknown";
  const matchLabel = matchedBy === "unique_code" ? "unique checkout code" : matchedBy === "exact_full_name" ? "exact full checkout name" : "unique buyer email fallback";
  const clueNote = "\n\n<i>Matched by " + matchLabel + ". This is only a reconciliation match; an administrator must verify the payment directly in Selar.</i>";

  try {
    if (kind === "contact") {
      const upd = await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "✅ I checked Selar — confirm payment", callback_data: "selarverify:" + target.id }, { text: "Reject request", callback_data: "reject:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nRequest: <code>${target.id}</code>\nProfile: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
      await sayBestEffort(e, target.telegram_chat_id, "A Selar payment notification was received. The admin must review and verify it before your request can be approved.");
    } else {
      const upd = await e.DB.prepare("UPDATE service_orders SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "✅ I checked Selar — confirm service payment", callback_data: "serviceverify:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nOrder: <code>${target.id}</code>\nService: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
    }
  } catch (err) {
    // Processing failed after the dedup marker was written: remove the marker so a
    // sender retry can reprocess the event, and alert the admin. Nothing was verified.
    await e.DB.prepare("DELETE FROM processed_sales WHERE provider_reference=?").bind(s.reference).run();
    try { await notifyAdminIfConfigured(e, `<b>Selar sale processing failed; event was not consumed</b>\nReference: <code>${esc(s.reference)}</code>\nThe sender may retry delivery. No payment was verified.`); } catch { /* preserve the original error */ }
    throw err;
  }
  return json({ ok: true, matched: true, reconciled_by: matchedBy });
}

async function abandonedCart(request: Request, e: Env) {
  if (provider(e) !== "selar" || !methods(e).includes("selar")) return json({ error: "selar_is_not_enabled" }, 409);
  if (!e.SELAR_WEBHOOK_SECRET || !safeEq(request.headers.get("x-selar-webhook-secret") || "", e.SELAR_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
  const parsed = await readJsonBody(request, 65536);
  if (!parsed.ok) return json({ error: parsed.error || "invalid_json" }, parsed.status || 400);
  const body: unknown = parsed.value;
  if (!body || typeof body !== "object") return json({ error: "invalid_cart_payload" }, 400);
  const o = body as Record<string, any>;
  const customerName = String(o.customer_full_name ?? o.buyer_full_name ?? o.customer_name ?? o.full_name ?? o.fullName ?? o.name ?? o.customer?.name ?? "").trim();
  const productCode = selarProductCode(o);
  const abandonedAt = String(o.abandoned_at ?? o.abandonedAt ?? "").trim();
  if (!customerName || !productCode || !abandonedAt || !Number.isFinite(Date.parse(abandonedAt))) {
    return json({ error: "invalid_cart_payload", expected: ["customer_name", "product_code", "abandoned_at"] }, 400);
  }
  const kind: "contact" | "service" | null = productCode === e.SELAR_PRODUCT_ID ? "contact" : productCode === e.SERVICE_PRODUCT_ID ? "service" : null;
  if (!kind) return json({ error: "wrong_product" }, 422);
  const eventKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([productCode, normName(customerName), new Date(abandonedAt).toISOString()].join("|")));
  const eventId = Array.from(new Uint8Array(eventKey)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (await e.DB.prepare("SELECT event_key FROM processed_abandoned_carts WHERE event_key=?").bind(eventId).first()) {
    return json({ ok: true, duplicate: true });
  }
  const code = codeInName(customerName);
  let target: any = null;
  const saleName = code ? customerName.replace(new RegExp("\\s*" + code + "\\s*$", "i"), "").trim() : "";
  if (code && kind === "contact") {
    const rows = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_name FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>();
    if (rows.results.length === 1 && (!rows.results[0].checkout_name || normName(rows.results[0].checkout_name) === normName(saleName))) target = rows.results[0];
  } else if (code && kind === "service") {
    const rows = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_name FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
    if (rows.results.length === 1 && (!rows.results[0].checkout_name || normName(rows.results[0].checkout_name) === normName(saleName))) target = rows.results[0];
  }
  const checkout = kind === "service" ? e.SERVICE_CHECKOUT_URL : e.SELAR_CHECKOUT_URL;
  if (target && !checkout) return json({ ok: true, matched: true, reminder_sent: false, reason: "checkout_not_configured" });
  const recorded = await e.DB.prepare("INSERT OR IGNORE INTO processed_abandoned_carts(event_key,product_code,request_id,abandoned_at) VALUES(?,?,?,?)").bind(eventId, productCode, target?.id ?? null, new Date(abandonedAt).toISOString()).run();
  if (recorded.meta?.changes === 0) return json({ ok: true, duplicate: true });
  if (!target) return json({ ok: true, matched: false });
  const extra = "\nIf you still want to continue, enter your full name followed by the unique code in the Selar name field.";
  try {
    await say(e, target.telegram_chat_id, "It looks like your Selar checkout was not completed. If you already paid, please contact support and we will check it manually. The bot does not confirm payments automatically. Please complete the checkout using your full name and code or send your email as a fallback clue for reconciliation." + extra);
  } catch (err) {
    await e.DB.prepare("DELETE FROM processed_abandoned_carts WHERE event_key=?").bind(eventId).run();
    throw err;
  }
  return json({ ok: true, matched: true, reminder_sent: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const u = new URL(request.url);
    if (request.method === "GET" && u.pathname === "/health") return json({ ok: true, service: "fansleak-contact-bot", provider: provider(env), methods: enabledMethods(env) });
    if (request.method === "OPTIONS" && u.pathname === "/public/hidden-profiles") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "https://fansleak.pages.dev", "access-control-allow-methods": "GET,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    if (request.method === "GET" && u.pathname === "/public/hidden-profiles") {
      const rows = await env.DB.prepare("SELECT profile_id FROM hidden_profiles").all<any>();
      return new Response(JSON.stringify({ hiddenProfileIds: (rows.results || []).map((row:any) => String(row.profile_id)) }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "https://fansleak.pages.dev", "cache-control": "no-store" } });
    }

    if (request.method === "POST" && u.pathname === "/telegram/webhook") {
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEq(request.headers.get("x-telegram-bot-api-secret-token") || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
      let update: Update;
      const parsed = await readJsonBody(request, 262144);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return json({ error: parsed.error || "invalid_json" }, parsed.status || 400);
      update = parsed.value as Update;
      try { if (update.message) await message(env, update.message); if (update.callback_query) await callback(env, update.callback_query); }
      catch (err) { console.error("Telegram update failed", String(err)); }
      return json({ ok: true });
    }
    if (request.method === "POST" && u.pathname === "/webhooks/selar-abandoned-cart") {
      try { return await abandonedCart(request, env); } catch (err) { console.error("Selar abandoned-cart webhook failed", String(err)); return json({ error: "internal_error" }, 500); }
    }
    if (request.method === "POST" && u.pathname === "/webhooks/selar") {
      try { return await selar(request, env); } catch (err) { console.error("Selar webhook failed", String(err)); return json({ error: "internal_error" }, 500); }
    }
    return json({ error: "not_found" }, 404);
  }
};
