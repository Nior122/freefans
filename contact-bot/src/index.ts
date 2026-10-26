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
  AI?: { run(model: string, input: { messages: Array<{ role: string; content: string }> }): Promise<{ response?: string }> };
  AI_MODEL?: string;
}
type TelegramPhotoSize = { file_id?: string; file_unique_id?: string; file_size?: number; width?: number; height?: number };
type TelegramDocument = { file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number };
type Msg = {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
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
  // Defence in depth: only the two public fields are ever carried into bot logic,
  // even if a future catalogue regression added restricted fields.
  return j.profiles
    .filter(p => p && typeof p.id === "string" && /^[A-Za-z0-9._-]{1,50}$/.test(p.id) && typeof p.name === "string" && p.name.trim().length > 0)
    .map(p => ({ id: p.id, name: p.name.slice(0, 120) }));
}
function paymentKeyboard(e: Env, id: string) {
  const rows: Record<string, unknown>[][] = [];
  if (enabledMethods(e).includes("selar")) rows.push([{ text: "💳 Pay with Selar", callback_data: `pay_selar:${id}` }]);
  rows.push([{ text: "🔎 I've paid — check again", callback_data: `paid:${id}` }]);
  return { inline_keyboard: rows };
}

async function loadCustomerOrderById(e: Env, id: string): Promise<CustomerOrder | null> {
  const contact = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,profile_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM contact_requests WHERE id=?").bind(id).first<any>();
  if (contact) return { kind: "contact", ...contact };
  const service = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,service_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM service_orders WHERE id=?").bind(id).first<any>();
  return service ? { kind: "service", ...service } : null;
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
  const activeService = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (activeService) return say(e, chat, "You already have a service purchase in progress. Finish it or contact support before starting a contact request.");
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

async function aiReply(e: Env, chat: string, userText: string, reminder = "") {
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
  const activeContact = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (activeContact) return say(e, chat, "You already have a FansLeak contact request in progress. Finish it or contact support before starting a service purchase.");
  const active = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (active) return say(e, chat, "You already have a service order in progress. Finish it or contact support before starting another.");
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
      if (raced) return say(e, chat, "You already have a service order in progress. Finish it or contact support before starting another.");
    }
  }
  if (!inserted) return say(e, chat, "I couldn't start your service order just now. Please try again in a moment.");
  return say(e, chat, "Hi! I’m the FansLeak AI assistant. Tell me what you need, and I’ll ask a few questions so I understand your request.\n\nOrder reference: <code>" + id + "</code>\n\nWhen you’re ready to pay, type PAY and I’ll send the checkout link.");
}

async function message(e: Env, m: Msg) {
  let t = (m.text || "").trim();
  const caption = (m.caption || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  const hasReceiptCandidateMedia = Boolean((Array.isArray(m.photo) && m.photo.length > 0) || m.document);
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
  if (!t) return;
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

  if (user === e.ADMIN_TELEGRAM_ID && (t === "/admin" || t === "/menu")) {
    return say(e, chat, "<b>FansLeak Admin Desk</b>\nChoose what you want to manage. Payment checks and contact release remain manual and consent-gated.", {
      inline_keyboard: [
        [{ text: "📥 Review contact requests", callback_data: "admin:pending" }],
        [{ text: "🧾 Review service orders", callback_data: "admin:orders" }],
        [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }],
        [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]
      ]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/message ")) {
    const match = t.match(/^\/message\s+([^\s]+)\s+([\s\S]{2,2500})$/i);
    if (!match) return say(e, chat, "Format: /message FL-ABC123 Your message here");
    const ref = match[1], body = match[2].trim();
    let order = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_code,profile_id AS target_id,'contact' AS kind FROM contact_requests WHERE id=? OR checkout_code=? ORDER BY created_at DESC LIMIT 1").bind(ref, ref.toUpperCase()).first<any>();
    if (!order) order = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_code,service_id AS target_id,'service' AS kind FROM service_orders WHERE id=? OR checkout_code=? ORDER BY created_at DESC LIMIT 1").bind(ref, ref.toUpperCase()).first<any>();
    if (!order) return say(e, chat, "No contact request or service order matched that UUID or FL- order code. Nothing was sent.");
    try { await say(e, order.telegram_chat_id, "💬 <b>Message from FansLeak support</b>\n\n" + esc(body)); }
    catch { return say(e, chat, "Telegram could not deliver the message. Check whether the customer has started the bot; no success was recorded."); }
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)").bind(user, "admin_message_customer", order.id, order.kind === "contact" ? order.target_id : null, "Admin sent support message for " + order.kind + " order " + order.checkout_code).run();
    return say(e, chat, "✅ Message sent for order <code>" + esc(order.checkout_code || ref) + "</code>.");
  }

  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/deliver ")) {
    const match = t.match(/^\/deliver\s+([0-9a-f-]{36})\s+([\s\S]{1,3500})$/i);
    if (!match) return say(e, chat, "Usage: /deliver ORDER_ID service details or fulfilment text");
    const order = await e.DB.prepare("SELECT id,telegram_chat_id,status FROM service_orders WHERE id=?").bind(match[1]).first<any>();
    if (!order || order.status !== "payment_verified") return say(e, chat, "Order not found or payment has not been verified. Nothing was sent.");
    const updateRes = await e.DB.prepare("UPDATE service_orders SET status='fulfilled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(order.id).run();
    if (!updateRes.meta?.changes) return say(e, chat, "Order was already fulfilled or status changed. Nothing was sent.");
    try {
      await tg(e, "sendMessage", { chat_id: order.telegram_chat_id, text: "Your service order is ready. Details from the provider:\n\n" + match[2], disable_web_page_preview: true });
    } catch (err) {
      await e.DB.prepare("UPDATE service_orders SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='fulfilled'").bind(order.id).run();
      throw err;
    }
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_order_fulfilled',?,?)").bind(user, order.id, "Admin sent service fulfilment").run();
    return say(e, chat, "Fulfilment sent to customer for order " + esc(String(order.id)));
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/orders") {
    const rows = await e.DB.prepare("SELECT id,service_id,telegram_username,telegram_user_id,status,CASE WHEN status='payment_verified' THEN substr(request_text,-180) ELSE 'Request hidden until payment verification' END AS summary FROM service_orders ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => [r.id, r.service_id, "@" + (r.telegram_username || "unknown"), "Telegram " + r.telegram_user_id, r.status, String(r.summary || "")].map(x => esc(String(x))).join(" | ")).join("\n") || "No service orders.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/setcontact ")) {
    const [, id, handle] = t.split(/\s+/);
    if (!id || !/^[A-Za-z0-9._-]{1,50}$/.test(id) || !handle || !/^@[A-Za-z0-9_]{5,32}$/.test(handle)) return say(e, chat, "Usage: /setcontact PROFILE_ID @telegram_handle");
    await e.DB.prepare("INSERT INTO creator_contacts(profile_id,contact_value,sharing_enabled,consent_confirmed_at) VALUES(?,?,0,NULL) ON CONFLICT(profile_id) DO UPDATE SET contact_value=excluded.contact_value,sharing_enabled=0,consent_confirmed_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id, handle).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id) VALUES(?,'set_contact_disabled',?)").bind(user, id).run();
    return say(e, chat, `Saved ${esc(handle)} for ${esc(id)}, with sharing disabled. Only use /enablecontact after the creator has explicitly authorised sharing.`);
  }
  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/enablecontact ")) {
    const id = t.split(/\s+/)[1];
    if (!id || !/^[A-Za-z0-9._-]{1,50}$/.test(id)) return say(e, chat, "Usage: /enablecontact PROFILE_ID");
    const found = await e.DB.prepare("SELECT profile_id FROM creator_contacts WHERE profile_id=?").bind(id).first();
    if (!found) return say(e, chat, "No contact saved. Use /setcontact first.");
    await e.DB.prepare("UPDATE creator_contacts SET sharing_enabled=1,consent_confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE profile_id=?").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'creator_consent_confirmed',?,'Admin attested creator authorisation')").bind(user, id).run();
    return say(e, chat, `Sharing enabled for ${esc(id)}. This records your confirmation that the creator authorised sharing.`);
  }
  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/disablecontact ")) {
    const id = t.split(/\s+/)[1];
    if (!id || !/^[A-Za-z0-9._-]{1,50}$/.test(id)) return say(e, chat, "Usage: /disablecontact PROFILE_ID");
    const updateRes = await e.DB.prepare("UPDATE creator_contacts SET sharing_enabled=0,consent_confirmed_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE profile_id=?").bind(id).run();
    if (!updateRes.meta?.changes) return say(e, chat, "No contact saved for " + esc(id));
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'creator_consent_revoked',?,'Admin revoked creator sharing consent')").bind(user, id).run();
    return say(e, chat, `Sharing disabled and consent revoked for ${esc(id)}.`);
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
      "/setcontact PROFILE_ID @handle — store a creator contact with sharing DISABLED",
      "/enablecontact PROFILE_ID — record that the creator explicitly authorised sharing",
      "/disablecontact PROFILE_ID — revoke sharing consent immediately",
      "",
      "If a customer says they paid and no backend sale is attached, the bot may forward their Selar receipt here with the order context and exact /verify command. A receipt is evidence only and never changes payment status by itself.",
      "Payments are never verified automatically. Contact details are only sent after manual payment verification, your approval, and recorded creator consent."
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
      return say(e, chat, answer ? esc(answer) : "Thanks. Tell me a little more about what you need, or type PAY when you’re ready to purchase.");
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
  return aiReply(e, chat, t);
}
async function callback(e: Env, u: NonNullable<Update["callback_query"]>) {
  const actor = String(u.from.id), data = u.data || "", chat = u.message?.chat.id;
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
      await say(e, chat, "<b>Message a customer</b>\nUse their FL- order code or full order UUID, then type your message.\n\nFormat: <code>/message FL-ABC123 Hi, I’m checking your request and will update you here.</code>\nThe bot sends the message privately to the Telegram account attached to that order. This does not change payment or approval status.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Customer-message instructions opened." });
    }
    if (action === "help") {
      await say(e, chat, "<b>Admin guide</b>\n• Review the real sale in Selar before confirming payment.\n• Payment confirmation and contact approval are separate actions.\n• Contact delivery requires explicit creator consent.\n• Use /message ORDER_CODE your message to contact a customer.\n• Use /help for all supported commands.\n• AI replies cannot verify payments or approve contact delivery.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
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
      if (r.status === "payment_verified") actions.push([{ text: "🔓 Approve & send authorised contact", callback_data: "approve:" + r.id }, { text: "❌ Reject request", callback_data: "reject:" + r.id }]);
      actions.push([{ text: "💬 How to message this customer", callback_data: "admin:message_help" }], [{ text: "↩️ Back to requests", callback_data: "admin:pending" }], [{ text: "🏠 Admin Desk", callback_data: "admin:home" }]);
      await say(e, chat, "<b>Contact request details</b>\nCode: <code>" + esc(r.checkout_code || "") + "</code>\nProfile: " + esc(r.profile_id || "unknown") + "\nStatus: <b>" + esc(r.status) + "</b>\nSale reference: " + (r.payment_reference ? "<code>" + esc(r.payment_reference) + "</code>" : "none attached") + "\n\nUse payment confirmation only after checking the real sale in Selar. Approval remains separate and requires creator consent.", { inline_keyboard: actions });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request details opened." });
    }
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown admin menu action." });
  }
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
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Now decide whether to approve the contact request.", { inline_keyboard: [[{ text: "🔓 Approve & send authorised contact", callback_data: "approve:" + id }, { text: "Reject", callback_data: "reject:" + id }]] });
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
  const c = await e.DB.prepare("SELECT contact_value,sharing_enabled,consent_confirmed_at FROM creator_contacts WHERE profile_id=?").bind(r.profile_id).first<any>();
  if (!c || c.sharing_enabled !== 1 || !c.consent_confirmed_at || !String(c.contact_value || "").trim()) {
    await notifyAdminIfConfigured(e, `Cannot approve request <code>${id}</code>: creator consent is not confirmed for <code>${esc(r.profile_id)}</code>. Use /enablecontact ${esc(r.profile_id)} first.`);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No authorised contact enabled." });
  }
  const updateRes = await e.DB.prepare("UPDATE contact_requests SET status='approved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(id).run();
  if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request was already approved or status changed." });
  // Re-verify consent for this exact creator and contact value immediately before
  // disclosure, so a revocation that raced the approval still fails closed.
  const recheck = await e.DB.prepare("SELECT contact_value,sharing_enabled,consent_confirmed_at FROM creator_contacts WHERE profile_id=?").bind(r.profile_id).first<any>();
  if (!recheck || recheck.sharing_enabled !== 1 || !recheck.consent_confirmed_at || recheck.contact_value !== c.contact_value) {
    await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='approved'").bind(id).run();
    await notifyAdminIfConfigured(e, `Approval aborted for request <code>${id}</code>: creator consent for <code>${esc(r.profile_id)}</code> changed before delivery. Nothing was sent.`);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Creator consent changed. Nothing was sent." });
  }
  try {
    await say(e, r.telegram_chat_id, `Request approved. Creator contact: <b>${esc(recheck.contact_value)}</b>\n\nPlease respect the creator's boundaries.`);
  } catch (err) {
    await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='approved'").bind(id).run();
    throw err;
  }
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'approve_request',?,?)").bind(actor, id, r.profile_id).run();
  return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Approved and sent." });
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
  let matchedBy: "unique_code" | "exact_full_name" | null = null;

  // A unique checkout code is sufficient, even if Selar's name differs.
  // If the code is absent/unknown/ambiguous, require an exact full-name match
  // against the saved checkout name. Never match on a first name or partial name.
  if (code) {
    const codeRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
    if (codeRows.results.length === 1) {
      target = codeRows.results[0];
      matchedBy = "unique_code";
    }
  }

  if (!target) {
    const saleName = s.customerName.replace(new RegExp("\\s*" + (code || "") + "\\s*$", "i"), "").trim();
    const fullName = normName(saleName);
    if (fullName.length < 5 || !fullName.includes(" ")) {
      return json({ ok: true, matched: false, reason: code ? "no_unique_code_or_full_name_match" : "missing_code_and_full_name" });
    }

    const nameRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE status='pending_payment' AND payment_method='selar' AND lower(trim(checkout_name))=? LIMIT 2").bind(fullName).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name FROM service_orders WHERE status='pending_payment' AND lower(trim(checkout_name))=? LIMIT 2").bind(fullName).all<any>();
    const exactNameRows = nameRows.results.filter((row: any) => row.checkout_name && normName(row.checkout_name) === fullName);
    if (exactNameRows.length !== 1) {
      return json({ ok: true, matched: false, reason: exactNameRows.length > 1 ? "ambiguous_full_name_match" : "no_unique_code_or_full_name_match" });
    }
    target = exactNameRows[0];
    matchedBy = "exact_full_name";
  }

  const saleInserted = await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email || target.buyer_email || "", 0, "UNK", s.productId, target.id).run();
  if (saleInserted.meta?.changes === 0) return json({ ok: true, duplicate: true });

  const effectiveCode = target.checkout_code || code || "unknown";
  const clueNote = "\n\n<i>Matched by " + (matchedBy === "unique_code" ? "unique checkout code" : "exact full checkout name") + ". This is only a reconciliation match; an administrator must verify the payment directly in Selar.</i>";

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
