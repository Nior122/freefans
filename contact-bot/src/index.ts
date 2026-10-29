import {
  CUSTOMER_LANGUAGE_BUTTON_TEXTS,
  CUSTOMER_START_BUTTON_TEXTS,
  LANGUAGE_PICKER_TITLE,
  SUPPORTED_LANGUAGES,
  aiLanguageInstruction,
  isLanguageCode,
  languageDisplayName,
  normalizeLanguage,
  orderStatusLabel,
  translate,
  ttsLanguage,
  type LanguageCode,
  type TranslationKey
} from "./i18n";

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
type HiddenProfileRow = { profile_id: string; hidden_by_admin?: string | null; reason?: string | null; hidden_at?: string | null };
type OrderKind = "contact" | "service";
type CustomerOrder = {
  kind: OrderKind;
  id: string;
  target_id?: string;
  request_text?: string | null;
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
  updated_at?: string;
};
type LanguagePreferenceRow = {
  telegram_user_id: string;
  telegram_chat_id: string;
  language_code?: string | null;
  pending_start_payload?: string | null;
  created_at?: string;
  updated_at?: string;
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
type ReceiptVerifyPrompt = {
  admin_telegram_id: string;
  order_id: string;
  order_kind: OrderKind;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
};
type AdminBroadcastDraft = { id: string; admin_telegram_id: string; message_text?: string | null; media_kind?: "photo" | "document" | null; media_file_id?: string | null; media_mime_type?: string | null; status: string; expires_at: string };
type BroadcastRecipientCounts = { total: number; pending: number; sending: number; sent: number; failed: number; uncertain: number; cancelled: number };
const BROADCAST_BATCH_SIZE = 25;
const BROADCAST_RECIPIENT_STALE_MINUTES = 10;
type AdminMessagePurpose = "support" | "rejection";
type AdminMessageDraft = {
  id: string;
  order_id: string;
  order_kind: OrderKind;
  admin_telegram_id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  checkout_code?: string | null;
  purpose?: AdminMessagePurpose | string | null;
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
type ServiceDeliveryDraft = {
  id: string;
  service_order_id: string;
  admin_telegram_id: string;
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
type AdminComposerKind = "request_delivery" | "service_delivery" | "support" | "broadcast";
type AdminComposerRef = {
  kind: AdminComposerKind;
  draftId: string;
  orderId?: string | null;
  orderKind?: OrderKind | null;
  checkoutCode?: string | null;
  targetId?: string | null;
  status: string;
  expiresAt?: string | null;
  updatedAt?: string | null;
  hasText: boolean;
  hasMedia: boolean;
  mediaLabel?: string | null;
  purpose?: AdminMessagePurpose | null;
};
type DraftRecoveryPayload = { kind: AdminComposerKind; draftId: string; updatedAt: string };
type AdminPendingAction = "hide_profile" | "close_pending_orders" | "recover_draft" | "delete_order" | "delete_orders_bulk";
const PENDING_CONTACT_STATUSES = ["awaiting_email", "pending_payment", "awaiting_bank_reference", "pending_manual_payment"] as const;
const PENDING_SERVICE_STATUSES = ["awaiting_request", "awaiting_email", "pending_payment"] as const;
const FINISHED_CONTACT_STATUSES = ["approved", "rejected", "expired"] as const;
const FINISHED_SERVICE_STATUSES = ["fulfilled", "cancelled"] as const;
type OrderDeletionScope = "pending" | "finished" | "all";
type PendingOrderSnapshotItem = { id: string; status: string };
type PendingOrderSnapshot = { contacts: PendingOrderSnapshotItem[]; services: PendingOrderSnapshotItem[] };
type SingleOrderDeletionPayload = { kind: OrderKind; id: string; status: string; checkoutCode?: string | null };
type BulkOrderDeletionPayload = { scope: OrderDeletionScope; contacts: PendingOrderSnapshotItem[]; services: PendingOrderSnapshotItem[] };
function parsePendingOrderSnapshot(value: unknown): PendingOrderSnapshot | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingOrderSnapshot>;
    const validItems = (items: unknown): PendingOrderSnapshotItem[] | null => {
      if (!Array.isArray(items)) return null;
      const out: PendingOrderSnapshotItem[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") return null;
        const id = String((item as any).id || "");
        const status = String((item as any).status || "");
        if (!/^[0-9a-f-]{36}$/i.test(id) || !status) return null;
        out.push({ id, status });
      }
      return out;
    };
    const contacts = validItems(parsed.contacts);
    const services = validItems(parsed.services);
    return contacts && services ? { contacts, services } : null;
  } catch {
    return null;
  }
}
function parseDraftRecoveryPayload(value: unknown): DraftRecoveryPayload | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DraftRecoveryPayload>;
    const kind = String(parsed.kind || "") as AdminComposerKind;
    const draftId = String(parsed.draftId || "");
    const updatedAt = String(parsed.updatedAt || "");
    if (!["request_delivery", "service_delivery", "support", "broadcast"].includes(kind)) return null;
    if (!/^[0-9a-f-]{36}$/i.test(draftId) || !updatedAt || updatedAt.length > 64) return null;
    return { kind, draftId, updatedAt };
  } catch {
    return null;
  }
}
function parseSingleOrderDeletionPayload(value: unknown): SingleOrderDeletionPayload | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SingleOrderDeletionPayload>;
    const kind = String(parsed.kind || "") as OrderKind;
    const id = String(parsed.id || "");
    const status = String(parsed.status || "");
    const checkoutCode = parsed.checkoutCode === null || parsed.checkoutCode === undefined ? null : String(parsed.checkoutCode);
    if (kind !== "contact" && kind !== "service") return null;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !status || status.length > 64) return null;
    if (checkoutCode !== null && checkoutCode.length > 32) return null;
    return { kind, id, status, checkoutCode };
  } catch {
    return null;
  }
}
function parseBulkOrderDeletionPayload(value: unknown): BulkOrderDeletionPayload | null {
  const snapshot = parsePendingOrderSnapshot(value);
  if (!snapshot || typeof value !== "string") return null;
  try {
    const scope = String((JSON.parse(value) as Partial<BulkOrderDeletionPayload>).scope || "");
    if (scope !== "pending" && scope !== "finished" && scope !== "all") return null;
    return { scope, contacts: snapshot.contacts, services: snapshot.services };
  } catch {
    return null;
  }
}
function isVoiceConsequentialAdminText(value: string): boolean {
  const text = value.trim();
  return /^(?:yes|yes please|confirm|confirm it|go ahead|do it)[.! ]*$/i.test(text)
    || /^\/(?:verify|verifyservice|reject|deleteorder|clearorders|expirepending)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)
    || /^(?:reject|decline)\s+(?:order\s+)?FL-[A-Z0-9]{6}[.! ]*$/i.test(text)
    || /^(?:delete|remove|clear)\b.*\b(?:order|orders|request|requests|FL-[A-Z0-9]{6})\b/i.test(text)
    || /^(?:close|cancel)\s+all\s+pending\s+orders[.! ]*$/i.test(text);
}
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
async function sendVoiceReply(e: Env, chat: string | number, text: string, language: LanguageCode = "en") {
  const lang = ttsLanguage(language);
  if (!e.AI || !text.trim() || !lang) return false;
  try {
    const result = await e.AI.run("@cf/myshell-ai/melotts", { prompt: text.slice(0, 700), lang });
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
  const language = await customerLanguage(e, m.from?.id ?? m.chat.id, m.chat.id);
  // LLaVA's Workers AI endpoint expects the actual image bytes plus a description prompt.
  // This model was smoke-tested against the account API and returned a non-empty description.
  const result = await e.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
    image: Array.from(bytes),
    description: ((prompt || "Describe this image and answer any question the user included. Be concise and helpful.") + "\n" + aiLanguageInstruction(language)).slice(0, 1000)
  });
  const answer = String(result?.answer || result?.response || result?.description || result?.result || "").trim();
  if (!answer) throw new Error("Image model returned no answer");
  return answer.slice(0, 3500);
}
async function sayBestEffort(e: Env, chat: string | number, text: string) {
  // Informational customer notifications must never roll back a recorded payment
  // or strand an admin action (e.g. the customer blocked the bot). Actual request
  // delivery and service fulfilment deliberately do NOT use this.
  try { await say(e, chat, text); } catch { /* best effort */ }
}

function tr(language: LanguageCode, key: TranslationKey, params: Record<string, string | number> = {}): string {
  return translate(normalizeLanguage(language), key, params);
}

async function getLanguagePreference(e: Env, userId: string): Promise<LanguagePreferenceRow | null> {
  if (!userId) return null;
  try {
    return await e.DB.prepare("SELECT telegram_user_id,telegram_chat_id,language_code,pending_start_payload,created_at,updated_at FROM user_language_preferences WHERE telegram_user_id=?").bind(String(userId)).first<LanguagePreferenceRow>();
  } catch {
    return null;
  }
}

async function savedCustomerLanguage(e: Env, userId?: string | number | null, chatId?: string | number | null): Promise<LanguageCode | null> {
  try {
    if (userId !== undefined && userId !== null && String(userId)) {
      const byUser = await getLanguagePreference(e, String(userId));
      if (isLanguageCode(byUser?.language_code)) return byUser.language_code;
    }
    if (chatId !== undefined && chatId !== null && String(chatId)) {
      const byChat = await e.DB.prepare("SELECT language_code FROM user_language_preferences WHERE telegram_chat_id=? AND language_code IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(String(chatId)).first<any>();
      if (isLanguageCode(byChat?.language_code)) return byChat.language_code;
    }
  } catch {
    return null;
  }
  return null;
}

async function customerLanguage(e: Env, userId?: string | number | null, chatId?: string | number | null): Promise<LanguageCode> {
  return (await savedCustomerLanguage(e, userId, chatId)) || "en";
}

async function customerLanguageForChat(e: Env, chat: string | number): Promise<LanguageCode> {
  return customerLanguage(e, String(chat), String(chat));
}

async function customerLanguageForOrder(
  e: Env,
  order?: Pick<CustomerOrder, "telegram_user_id" | "telegram_chat_id"> | { telegram_user_id?: unknown; telegram_chat_id?: unknown } | null
): Promise<LanguageCode> {
  if (!order) return "en";
  return customerLanguage(e, order.telegram_user_id ? String(order.telegram_user_id) : null, order.telegram_chat_id ? String(order.telegram_chat_id) : null);
}

function safePendingStartPayload(value: unknown): string {
  const payload = String(value || "").trim();
  if (!payload) return "";
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(payload)) return "";
  return payload.startsWith("contact_") || payload.startsWith("service_") ? payload : "";
}

async function savePendingStartPayload(e: Env, userId: string, chatId: string, payload: string): Promise<void> {
  try {
    await e.DB.prepare(
      "INSERT INTO user_language_preferences(telegram_user_id,telegram_chat_id,language_code,pending_start_payload) VALUES(?,?,NULL,?) " +
      "ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,pending_start_payload=excluded.pending_start_payload,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(String(userId), String(chatId), safePendingStartPayload(payload) || null).run();
  } catch {
    // The picker can still be shown; after selection it will fall back to the
    // plain welcome if the pending payload could not be stored.
  }
}

async function saveCustomerLanguage(e: Env, userId: string, chatId: string, language: LanguageCode): Promise<void> {
  await e.DB.prepare(
    "INSERT INTO user_language_preferences(telegram_user_id,telegram_chat_id,language_code,pending_start_payload) VALUES(?,?,?,NULL) " +
    "ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,language_code=excluded.language_code,pending_start_payload=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ).bind(String(userId), String(chatId), normalizeLanguage(language)).run();
}

function languagePickerKeyboard() {
  return {
    inline_keyboard: SUPPORTED_LANGUAGES.map(language => [{ text: language.pickerLabel, callback_data: "language:set:" + language.code }])
  };
}

async function sendLanguagePicker(e: Env, chat: string | number) {
  return say(e, chat, LANGUAGE_PICKER_TITLE, languagePickerKeyboard());
}

// Plain AI chat replies (which have no workflow action buttons of their own)
// always carry the two customer navigation buttons.
function customerNavKeyboard(e: Env, language: LanguageCode = "en") {
  const siteUrl = (e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "");
  return {
    inline_keyboard: [
      [{ text: tr(language, "viewWebsite"), url: siteUrl }],
      [{ text: tr(language, "telegramChannel"), callback_data: "services:join" }]
    ]
  };
}

// Persistent reply keyboard shown beside the message box. Once sent it stays
// in the chat, so a confused customer can always get back to the main menu.
const CUSTOMER_START_BUTTON_TEXT = "🚀 Start";
function persistentStartKeyboard(language: LanguageCode = "en") {
  return {
    keyboard: [[{ text: tr(language, "startButton") }, { text: tr(language, "languageButton") }]],
    resize_keyboard: true,
    is_persistent: true
  };
}
async function fetchPublicCatalogue(e: Env): Promise<Profile[]> {
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

async function hiddenProfileRows(e: Env): Promise<HiddenProfileRow[]> {
  const hidden = await e.DB.prepare("SELECT profile_id,hidden_by_admin,reason,hidden_at FROM hidden_profiles ORDER BY hidden_at ASC, profile_id ASC").all<HiddenProfileRow>();
  return hidden.results || [];
}

async function catalogue(e: Env): Promise<Profile[]> {
  const [sourceProfiles, hidden] = await Promise.all([fetchPublicCatalogue(e), hiddenProfileRows(e)]);
  const hiddenIds = new Set(hidden.map(row => String(row.profile_id)));
  return sourceProfiles.filter(p => !hiddenIds.has(p.id));
}

async function catalogueIncludingHidden(e: Env): Promise<{ profiles: Profile[]; hiddenRows: HiddenProfileRow[] }> {
  const [profiles, hiddenRows] = await Promise.all([fetchPublicCatalogue(e), hiddenProfileRows(e)]);
  return { profiles, hiddenRows };
}
function paymentKeyboard(e: Env, id: string, language: LanguageCode = "en") {
  const rows: Record<string, unknown>[][] = [];
  if (enabledMethods(e).includes("selar")) rows.push([{ text: tr(language, "payNow"), callback_data: `pay_selar:${id}` }]);
  rows.push([{ text: tr(language, "copyUniqueCode"), callback_data: `copycode:${id}` }]);
  rows.push([{ text: tr(language, "paidCheckAgain"), callback_data: `paid:${id}` }]);
  return { inline_keyboard: rows };
}

async function loadCustomerOrderByKind(e: Env, kind: OrderKind, id: string): Promise<CustomerOrder | null> {
  if (kind === "contact") {
    const contact = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,profile_id AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at,updated_at FROM contact_requests WHERE id=?").bind(id).first<any>();
    return contact ? { kind: "contact", ...contact } : null;
  }
  const service = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,telegram_username,service_id AS target_id,request_text,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at,updated_at FROM service_orders WHERE id=?").bind(id).first<any>();
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

function receiptReviewCallback(action: "verify" | "reject" | "rejectnow" | "confirmreject" | "cancel", order: Pick<CustomerOrder, "kind" | "id">): string {
  return "receipt:" + action + ":" + (order.kind === "contact" ? "c" : "s") + ":" + order.id;
}

function receiptReviewKeyboard(order: CustomerOrder) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Verify", callback_data: receiptReviewCallback("verify", order) },
        { text: "🚫 Reject & message", callback_data: receiptReviewCallback("reject", order) }
      ],
      [{ text: "⛔ Just reject", callback_data: receiptReviewCallback("rejectnow", order) }],
      [{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]
    ]
  };
}

async function activeReceiptVerifyPrompt(e: Env, actor: string): Promise<ReceiptVerifyPrompt | null> {
  await e.DB.prepare("DELETE FROM admin_receipt_verify_prompts WHERE admin_telegram_id=? AND datetime(expires_at) <= datetime('now')").bind(actor).run();
  const prompt = await e.DB.prepare("SELECT admin_telegram_id,order_id,order_kind,expires_at,created_at,updated_at FROM admin_receipt_verify_prompts WHERE admin_telegram_id=?").bind(actor).first<ReceiptVerifyPrompt>();
  if (!prompt) return null;
  if (isDraftExpired(prompt.expires_at)) {
    await e.DB.prepare("DELETE FROM admin_receipt_verify_prompts WHERE admin_telegram_id=?").bind(actor).run();
    return null;
  }
  return prompt;
}

async function deleteReceiptVerifyPrompt(e: Env, actor: string, order?: Pick<CustomerOrder, "kind" | "id">): Promise<boolean> {
  const result = order
    ? await e.DB.prepare("DELETE FROM admin_receipt_verify_prompts WHERE admin_telegram_id=? AND order_id=? AND order_kind=?").bind(actor, order.id, order.kind).run()
    : await e.DB.prepare("DELETE FROM admin_receipt_verify_prompts WHERE admin_telegram_id=?").bind(actor).run();
  return Boolean(result.meta?.changes);
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
  const language = await customerLanguage(e, user, chat);
  if (!e.ADMIN_TELEGRAM_ID) {
    await say(e, chat, tr(language, "receiptReviewUnavailable", { prefix }));
    return "admin_unavailable";
  }
  const forwarded = await forwardedReceiptForOrder(e, order.id);
  if (forwarded) {
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, order.id).run();
    await say(e, chat, tr(language, order.kind === "contact" ? "receiptAlreadyForwardedContact" : "receiptAlreadyForwardedService", { prefix }));
    return "receipt_already_forwarded";
  }
  await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
  await say(e, chat, tr(language, "receiptNeeded", { prefix, code: esc(order.checkout_code || "") }));
  return "receipt_needed";
}

async function handlePaidClaim(e: Env, chat: string, user: string, order: CustomerOrder | null, options: { nameJustRecorded?: boolean } = {}): Promise<string> {
  const language = await customerLanguage(e, user, chat);
  const prefix = options.nameJustRecorded ? tr(language, "thanksCheckoutNameRecorded") : "";
  if (!order || String(order.telegram_user_id) !== user) {
    await say(e, chat, tr(language, "noCurrentOrder"));
    return "no_order";
  }
  if (order.status === "payment_verified") {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, tr(language, order.kind === "contact" ? "paymentVerifiedContact" : "paymentVerifiedService", { prefix }));
    return "verified";
  }
  if (order.status === "approved" || order.status === "fulfilled") {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, tr(language, order.kind === "contact" ? "alreadyCompletedContact" : "alreadyCompletedService", { prefix, status: esc(orderStatusLabel(language, order.status)) }));
    return "completed";
  }
  if (order.status === "awaiting_request") {
    await say(e, chat, tr(language, "serviceNotPaymentStep"));
    return "awaiting_request";
  }
  if (order.status !== "pending_payment") {
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, order.id).run();
    await say(e, chat, tr(language, order.kind === "contact" ? "noLongerWaitingPaymentContact" : "noLongerWaitingPaymentService"));
    return "closed";
  }

  // Always check the existing backend evidence before asking for a receipt.
  // A webhook/manual sale already has an admin verification path, so a receipt
  // would only duplicate that process.
  const saleReference = await attachedSaleReference(e, order);
  if (saleReference) {
    await clearPaymentPrompts(e, user, order.id);
    await say(e, chat, tr(language, order.kind === "contact" ? "saleFoundManualQueueContact" : "saleFoundManualQueueService", { prefix }));
    return "sale_found";
  }

  if (!String(order.checkout_name || "").trim()) {
    await e.DB.prepare("INSERT OR REPLACE INTO checkout_name_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
    await say(e, chat, tr(language, order.kind === "contact" ? "checkoutNameNeededContact" : "checkoutNameNeededService", { code: esc(order.checkout_code || "FL-7K4P9A") }));
    return "name_needed";
  }
  return promptForReceiptReview(e, chat, user, order, prefix);
}

function receiptFileSize(value: unknown): number | null {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? Math.trunc(size) : null;
}

function extractSupportMedia(m: Msg): { media?: ReceiptMedia; unsupported?: string; unsupportedKey?: TranslationKey } {
  if (m.video) {
    const video = m.video;
    if (typeof video.file_id !== "string" || !video.file_id || video.file_id.length > 512) return { unsupported: "That video did not include a usable Telegram file reference. Please send it again." };
    const fileSize = receiptFileSize(video.file_size);
    if (fileSize !== null && fileSize > 20_000_000) return { unsupported: "Videos must be 20 MB or smaller to attach to a support message." };
    return { media: { kind: "document", fileId: video.file_id, fileUniqueId: typeof video.file_unique_id === "string" ? video.file_unique_id.slice(0, 512) : null, mimeType: (video.mime_type || "video/mp4").toLowerCase().split(";", 1)[0].trim().slice(0, 100), fileSize } };
  }
  return extractReceiptMedia(m);
}

function extractReceiptMedia(m: Msg): { media?: ReceiptMedia; unsupported?: string; unsupportedKey?: TranslationKey } {
  const maxBytes = 20_000_000;
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const candidates = m.photo.filter(p => typeof p?.file_id === "string" && p.file_id.length > 0 && p.file_id.length <= 512);
    if (candidates.length === 0) return { unsupported: "That photo did not include a usable Telegram file reference. Please send the receipt again as a photo or PDF/image document.", unsupportedKey: "receiptUnsupportedPhotoInvalid" };
    const photo = candidates.reduce((best, current) => {
      const bestScore = Number(best.file_size || 0) || Number(best.width || 0) * Number(best.height || 0);
      const currentScore = Number(current.file_size || 0) || Number(current.width || 0) * Number(current.height || 0);
      return currentScore > bestScore ? current : best;
    });
    const fileSize = receiptFileSize(photo.file_size);
    if (fileSize !== null && fileSize > maxBytes) return { unsupported: "That receipt photo is too large for the bot to forward safely. Please send a smaller photo or PDF/image document.", unsupportedKey: "receiptUnsupportedPhotoTooLarge" };
    return { media: { kind: "photo", fileId: String(photo.file_id), fileUniqueId: typeof photo.file_unique_id === "string" ? photo.file_unique_id.slice(0, 512) : null, mimeType: "image/jpeg", fileSize } };
  }

  if (m.document) {
    const doc = m.document;
    if (typeof doc.file_id !== "string" || !doc.file_id || doc.file_id.length > 512) return { unsupported: "That document did not include a usable file reference. Please send your payment receipt again as a photo or PDF/image document.", unsupportedKey: "receiptUnsupportedDocumentInvalid" };
    const fileSize = receiptFileSize(doc.file_size);
    if (fileSize !== null && fileSize > maxBytes) return { unsupported: "That receipt document is too large for the bot to forward safely. Please send a smaller PDF/image document or a photo.", unsupportedKey: "receiptUnsupportedDocumentTooLarge" };
    const mimeType = typeof doc.mime_type === "string" ? doc.mime_type.toLowerCase().split(";", 1)[0].trim().slice(0, 100) : "";
    const extension = (typeof doc.file_name === "string" ? doc.file_name.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] : "") || "";
    const allowedMime = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    const allowedExtension = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);
    const genericMime = !mimeType || mimeType === "application/octet-stream";
    if (!allowedMime.has(mimeType) && !(genericMime && allowedExtension.has(extension))) {
      return { unsupported: "I can forward a payment receipt only as a Telegram photo or a PDF, JPG, PNG, or WebP document. Please send one of those formats; do not send archives or other files.", unsupportedKey: "receiptUnsupportedFormat" };
    }
    const inferredMime = mimeType || (extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg");
    return { media: { kind: "document", fileId: doc.file_id, fileUniqueId: typeof doc.file_unique_id === "string" ? doc.file_unique_id.slice(0, 512) : null, mimeType: inferredMime, fileSize } };
  }
  return {};
}

const ADMIN_MESSAGE_TEXT_LIMIT = 2500;
const ADMIN_MESSAGE_CAPTION_LIMIT = 1024;

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

const ADMIN_COMPOSER_LABELS: Record<AdminComposerKind, string> = {
  request_delivery: "profile-request delivery",
  service_delivery: "service fulfilment",
  support: "customer support",
  broadcast: "broadcast"
};

function adminComposerLabel(kind: AdminComposerKind): string {
  return ADMIN_COMPOSER_LABELS[kind];
}

function adminComposerDisplayLabel(composer: AdminComposerRef): string {
  return composer.kind === "support" && composer.purpose === "rejection" ? "rejection follow-up" : adminComposerLabel(composer.kind);
}

function adminComposerCancelCallback(composer: AdminComposerRef): string {
  if (composer.kind === "request_delivery") return "draft:cancel:" + composer.draftId;
  if (composer.kind === "service_delivery") return "service-delivery:cancel:" + composer.draftId;
  if (composer.kind === "support") return "support-message:cancel:" + composer.draftId;
  return "broadcast:cancel:" + composer.draftId;
}

function adminComposerRecoveryCommand(composer: AdminComposerRef): string {
  const token = composer.kind === "request_delivery"
    ? "request"
    : composer.kind === "service_delivery"
      ? "service"
      : composer.kind;
  return "/recoverdraft " + token + " " + composer.draftId;
}

function inactiveDraftMessage(status: unknown, subject = "Draft"): string {
  const normalized = String(status || "unknown").toLowerCase();
  if (normalized === "sent") return subject + " was already sent. It will not be sent again.";
  if (normalized === "sending") return subject + " is locked because its Telegram outcome needs review. It was not sent again.";
  if (normalized === "cancelled") return subject + " was already cancelled. Nothing was sent by this tap.";
  if (normalized === "expired") return subject + " expired. Nothing was sent by this tap.";
  if (normalized === "partial") return subject + " already finished with some failed recipients. It will not be sent again.";
  if (normalized === "draft") return subject + " is still editable.";
  return subject + " is no longer active (status: " + normalized + "). Nothing was sent by this tap.";
}

async function expireStaleAdminComposers(e: Env, adminTelegramId: string) {
  const tables = ["delivery_drafts", "service_delivery_drafts", "admin_message_drafts", "admin_broadcast_drafts"] as const;
  for (const table of tables) {
    await e.DB.prepare("UPDATE " + table + " SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE admin_telegram_id=? AND status='draft' AND datetime(expires_at) <= datetime('now')").bind(adminTelegramId).run();
  }
}

async function listAdminDraftStates(e: Env, adminTelegramId: string, statuses: string[]): Promise<AdminComposerRef[]> {
  await expireStaleAdminComposers(e, adminTelegramId);
  const placeholders = statuses.map(() => "?").join(",");
  const [requestRows, serviceRows, supportRows, broadcastRows] = await Promise.all([
    e.DB.prepare("SELECT d.id,d.request_id AS order_id,d.checkout_code,d.message_text,d.media_kind,d.media_file_id,d.media_mime_type,d.status,d.expires_at,d.updated_at,r.profile_id AS target_id FROM delivery_drafts d LEFT JOIN contact_requests r ON r.id=d.request_id WHERE d.admin_telegram_id=? AND d.status IN (" + placeholders + ") ORDER BY d.updated_at DESC").bind(adminTelegramId, ...statuses).all<any>(),
    e.DB.prepare("SELECT d.id,d.service_order_id AS order_id,o.checkout_code,d.message_text,d.media_kind,d.media_file_id,d.media_mime_type,d.status,d.expires_at,d.updated_at,o.service_id AS target_id FROM service_delivery_drafts d LEFT JOIN service_orders o ON o.id=d.service_order_id WHERE d.admin_telegram_id=? AND d.status IN (" + placeholders + ") ORDER BY d.updated_at DESC").bind(adminTelegramId, ...statuses).all<any>(),
    e.DB.prepare("SELECT id,order_id,order_kind,checkout_code,purpose,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,updated_at FROM admin_message_drafts WHERE admin_telegram_id=? AND status IN (" + placeholders + ") ORDER BY updated_at DESC").bind(adminTelegramId, ...statuses).all<any>(),
    e.DB.prepare("SELECT id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,updated_at FROM admin_broadcast_drafts WHERE admin_telegram_id=? AND status IN (" + placeholders + ") ORDER BY updated_at DESC").bind(adminTelegramId, ...statuses).all<any>()
  ]);
  const toRef = (kind: AdminComposerKind, row: any, orderKind: OrderKind | null): AdminComposerRef => ({
    kind,
    draftId: String(row.id),
    orderId: row.order_id ? String(row.order_id) : null,
    orderKind,
    checkoutCode: row.checkout_code ? String(row.checkout_code) : null,
    targetId: row.target_id ? String(row.target_id) : null,
    status: String(row.status || ""),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    hasText: Boolean(String(row.message_text || "").trim()),
    hasMedia: Boolean(row.media_file_id),
    mediaLabel: row.media_file_id ? String(row.media_mime_type || row.media_kind || "media") : null,
    purpose: row.purpose === "rejection" ? "rejection" : row.purpose === "support" ? "support" : null
  });
  return [
    ...(requestRows.results || []).map(row => toRef("request_delivery", row, "contact")),
    ...(serviceRows.results || []).map(row => toRef("service_delivery", row, "service")),
    ...(supportRows.results || []).map(row => toRef("support", row, row.order_kind === "service" ? "service" : "contact")),
    ...(broadcastRows.results || []).map(row => toRef("broadcast", row, null))
  ].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

async function listEditableAdminComposers(e: Env, adminTelegramId: string): Promise<AdminComposerRef[]> {
  return listAdminDraftStates(e, adminTelegramId, ["draft"]);
}

type AdminComposerException = { kind?: AdminComposerKind; draftId?: string; orderId?: string; orderKind?: OrderKind };

function adminComposerMatchesException(composer: AdminComposerRef, except?: AdminComposerException): boolean {
  if (!except) return false;
  if (except.kind && composer.kind !== except.kind) return false;
  if (except.draftId && composer.draftId !== except.draftId) return false;
  if (except.orderId && composer.orderId !== except.orderId) return false;
  if (except.orderKind && composer.orderKind !== except.orderKind) return false;
  return Boolean(except.kind || except.draftId || except.orderId);
}

async function adminComposerConflicts(e: Env, adminTelegramId: string, except?: AdminComposerException): Promise<AdminComposerRef[]> {
  const composers = await listEditableAdminComposers(e, adminTelegramId);
  return composers.filter(composer => !adminComposerMatchesException(composer, except));
}

async function replyAdminComposerConflict(e: Env, chat: string | number, conflicts: AdminComposerRef[], attemptedAction: string) {
  const lines = conflicts.map(composer => {
    const reference = composer.checkoutCode || composer.orderId || composer.draftId;
    return "• <b>" + esc(adminComposerDisplayLabel(composer)) + "</b> · <code>" + esc(reference) + "</code> · expires " + esc(String(composer.expiresAt || "unknown")) + " UTC";
  });
  const keyboard = conflicts
    .filter(composer => composer.status === "draft")
    .slice(0, 4)
    .map(composer => [{ text: "✖️ Cancel " + adminComposerDisplayLabel(composer), callback_data: adminComposerCancelCallback(composer) }]);
  return say(e, chat, "⚠️ <b>Another composer is already open.</b>\n" + lines.join("\n") + "\n\nFinish, send, or cancel the current composer before " + esc(attemptedAction) + ". Ordinary text and media edit only the one open composer; nothing was changed or sent by this attempt. Use /drafts to inspect draft state.", keyboard.length ? { inline_keyboard: keyboard } : undefined);
}

async function loadAdminDraftStateById(e: Env, adminTelegramId: string, kind: AdminComposerKind, draftId: string): Promise<AdminComposerRef | null> {
  const states = await listAdminDraftStates(e, adminTelegramId, ["draft", "sending", "sent", "cancelled", "expired", "partial"]);
  return states.find(state => state.kind === kind && state.draftId === draftId) || null;
}

const ADMIN_DRAFT_RECOVERY_TABLES: Record<AdminComposerKind, string> = {
  request_delivery: "delivery_drafts",
  service_delivery: "service_delivery_drafts",
  support: "admin_message_drafts",
  broadcast: "admin_broadcast_drafts"
};

function adminMessageCaption(body: string, language: LanguageCode = "en"): string {
  return tr(language, "adminSupportHeader") + "\n\n" + esc(body);
}

function adminMessagePurpose(draft: AdminMessageDraft): AdminMessagePurpose {
  return draft.purpose === "rejection" ? "rejection" : "support";
}

function adminMessageKeyboard(draftId: string, purpose: AdminMessagePurpose = "support", order?: Pick<CustomerOrder, "kind" | "id"> | null) {
  const rows: Record<string, unknown>[][] = [
    [{ text: "👀 Preview", callback_data: "support-message:preview:" + draftId }],
    [
      { text: purpose === "rejection" ? "🚫 Reject & send follow-up" : "✅ Send to customer", callback_data: "support-message:send:" + draftId },
      { text: "✖️ Cancel", callback_data: "support-message:cancel:" + draftId }
    ]
  ];
  // From inside the rejection composer the admin can also skip composing and
  // reject immediately (a separate confirmation panel is shown first).
  if (purpose === "rejection" && order) {
    rows.push([{ text: "⛔ Reject now (no follow-up)", callback_data: receiptReviewCallback("rejectnow", order) }]);
  }
  return { inline_keyboard: rows };
}

function adminMessageBody(draft: AdminMessageDraft): string {
  return String(draft.message_text || "").trim();
}

function adminMessageOutgoingBody(draft: AdminMessageDraft, order?: CustomerOrder | null, language: LanguageCode = "en"): string {
  const body = adminMessageBody(draft);
  if (adminMessagePurpose(draft) !== "rejection") return body;
  const code = String(order?.checkout_code || draft.checkout_code || draft.order_id);
  const intro = tr(language, "rejectionIntro", { code });
  return body ? intro + "\n\n" + body : intro + "\n\n" + tr(language, "rejectionHelp");
}

function adminMessageContentDetails(draft: AdminMessageDraft): string {
  const body = adminMessageBody(draft);
  return "purpose=" + adminMessagePurpose(draft) + "; media=" + (draft.media_file_id ? String(draft.media_kind || "file") : "none") + "; text_length=" + body.length;
}

function adminMessageSendProblem(draft: AdminMessageDraft, order?: CustomerOrder | null, language: LanguageCode = "en"): string {
  const body = adminMessageBody(draft);
  const outgoingBody = adminMessageOutgoingBody(draft, order, language);
  if (!body && !draft.media_file_id) return "Add a message or attach one photo/document before sending.";
  if (body.length > ADMIN_MESSAGE_TEXT_LIMIT) return "Support message text is too long. Shorten it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer.";
  if (draft.media_file_id && draft.media_kind !== "photo" && draft.media_kind !== "document") return "The attached media type is not supported. Nothing was sent.";
  if (draft.media_file_id && outgoingBody && adminMessageCaption(outgoingBody, language).length > ADMIN_MESSAGE_CAPTION_LIMIT) {
    return "The text is too long to use as a Telegram media caption (" + adminMessageCaption(outgoingBody, language).length + "/" + ADMIN_MESSAGE_CAPTION_LIMIT + "). Shorten the text, then preview again.";
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
  return e.DB.prepare("SELECT id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,purpose,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM admin_message_drafts WHERE id=?").bind(draftId).first<AdminMessageDraft>();
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
  await expireStaleAdminComposers(e, adminTelegramId);
  return e.DB.prepare("SELECT id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at FROM admin_broadcast_drafts WHERE admin_telegram_id=? AND status IN ('draft','sending') ORDER BY created_at DESC LIMIT 1").bind(adminTelegramId).first<AdminBroadcastDraft>();
}
async function activeAdminMessageDraft(e: Env, adminTelegramId: string): Promise<AdminMessageDraft | null> {
  const draft = await e.DB.prepare("SELECT id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,purpose,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM admin_message_drafts WHERE admin_telegram_id=? AND status='draft' ORDER BY updated_at DESC LIMIT 1").bind(adminTelegramId).first<AdminMessageDraft>();
  if (!draft) return null;
  return (await expireAdminMessageDraftIfNeeded(e, draft)) ? null : draft;
}

async function activeDeliveryDraft(e: Env, adminTelegramId: string): Promise<any | null> {
  const draft = await e.DB.prepare("SELECT id,request_id,checkout_code,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,updated_at FROM delivery_drafts WHERE admin_telegram_id=? AND status='draft' ORDER BY updated_at DESC LIMIT 1").bind(adminTelegramId).first<any>();
  if (!draft) return null;
  if (isDraftExpired(draft.expires_at)) {
    await e.DB.prepare("UPDATE delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    return null;
  }
  return draft;
}

const SERVICE_DELIVERY_TEXT_LIMIT = 3500;
const SERVICE_DELIVERY_CAPTION_LIMIT = 1024;

async function activeServiceDeliveryDraft(e: Env, adminTelegramId: string): Promise<ServiceDeliveryDraft | null> {
  const draft = await e.DB.prepare("SELECT id,service_order_id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM service_delivery_drafts WHERE admin_telegram_id=? AND status='draft' ORDER BY updated_at DESC LIMIT 1").bind(adminTelegramId).first<ServiceDeliveryDraft>();
  if (!draft) return null;
  if (isDraftExpired(draft.expires_at)) {
    await e.DB.prepare("UPDATE service_delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    return null;
  }
  return draft;
}

async function loadServiceDeliveryDraft(e: Env, draftId: string): Promise<ServiceDeliveryDraft | null> {
  return e.DB.prepare("SELECT id,service_order_id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at,delivered_at,created_at,updated_at FROM service_delivery_drafts WHERE id=?").bind(draftId).first<ServiceDeliveryDraft>();
}

async function loadServiceDeliveryDraftContext(e: Env, draftId: string): Promise<{ draft: ServiceDeliveryDraft; order: CustomerOrder | null } | null> {
  const draft = await loadServiceDeliveryDraft(e, draftId);
  if (!draft) return null;
  const order = await loadCustomerOrderByKind(e, "service", draft.service_order_id);
  return { draft, order };
}

function serviceDeliveryBody(draft: ServiceDeliveryDraft): string {
  return String(draft.message_text || "").trim();
}

function serviceDeliveryCaption(body: string, language: LanguageCode = "en"): string {
  const header = tr(language, "serviceDeliveryHeader");
  return body ? header + "\n\n" + body : header;
}

function serviceDeliverySendProblem(draft: ServiceDeliveryDraft, language: LanguageCode = "en"): string {
  const body = serviceDeliveryBody(draft);
  if (!body && !draft.media_file_id) return "Add fulfilment text or attach one photo, video, or document before sending.";
  if (body.length > SERVICE_DELIVERY_TEXT_LIMIT) return "Service fulfilment text is too long. Shorten it to " + SERVICE_DELIVERY_TEXT_LIMIT + " characters or fewer.";
  if (draft.media_file_id && draft.media_kind !== "photo" && draft.media_kind !== "document") return "The attached service media type is not supported. Nothing was sent.";
  if (draft.media_file_id && serviceDeliveryCaption(body, language).length > SERVICE_DELIVERY_CAPTION_LIMIT) {
    return "The fulfilment text is too long to use as a Telegram media caption (" + serviceDeliveryCaption(body, language).length + "/" + SERVICE_DELIVERY_CAPTION_LIMIT + "). Shorten the text, then preview again.";
  }
  return "";
}

function serviceDeliveryKeyboard(draftId: string, includeSend = true) {
  const rows: Record<string, unknown>[][] = [[{ text: "👀 Preview", callback_data: "service-delivery:preview:" + draftId }]];
  if (includeSend) rows.push([
    { text: "✅ Confirm and send", callback_data: "service-delivery:send:" + draftId },
    { text: "✖️ Cancel", callback_data: "service-delivery:cancel:" + draftId }
  ]);
  else rows.push([{ text: "✖️ Cancel", callback_data: "service-delivery:cancel:" + draftId }]);
  return { inline_keyboard: rows };
}

function serviceDeliveryDraftSummary(draft: ServiceDeliveryDraft, order: CustomerOrder, heading = "📝 <b>Service fulfilment draft</b>"): string {
  const body = serviceDeliveryBody(draft);
  const problem = serviceDeliverySendProblem(draft);
  const lines = [
    heading,
    "Order code: <code>" + esc(String(order.checkout_code || order.id)) + "</code>",
    "Order UUID: <code>" + esc(order.id) + "</code>",
    "Service: <code>" + esc(String(order.target_id || "unknown")) + "</code>",
    "Order status: <b>" + esc(order.status) + "</b>",
    "Attachment: " + (draft.media_file_id ? "One " + esc(String(draft.media_kind || "file")) + " attached" + (draft.media_mime_type ? " (" + esc(String(draft.media_mime_type)) + ")" : "") : "None"),
    "",
    "<b>Fulfilment message</b>",
    body ? esc(body) : draft.media_file_id ? "<i>Media only — no fulfilment text.</i>" : "<i>No text or attachment yet. Send text and/or one photo, video, or document in this private chat.</i>"
  ];
  if (problem && (body || draft.media_file_id)) lines.push("", "⚠️ " + esc(problem));
  lines.push("", "<i>Draft only — nothing has been sent. Expires at " + esc(String(draft.expires_at || "unknown")) + " UTC. Sending will mark this service order fulfilled only after Telegram accepts the message.</i>");
  return lines.join("\n");
}

async function sendServiceDeliveryDraftSummary(
  e: Env,
  chat: string | number,
  draft: ServiceDeliveryDraft,
  order: CustomerOrder,
  options: { heading?: string; includeMediaPreview?: boolean; note?: string } = {}
) {
  if (options.includeMediaPreview && draft.media_file_id && (draft.media_kind === "photo" || draft.media_kind === "document")) {
    try {
      const previewCaption = "👀 Service attachment preview for order " + String(order.checkout_code || order.id) + "\nPreview only — nothing has been sent to the customer.";
      if (draft.media_kind === "photo") await tg(e, "sendPhoto", { chat_id: chat, photo: draft.media_file_id, caption: previewCaption });
      else if (/^video\//i.test(draft.media_mime_type || "")) await tg(e, "sendVideo", { chat_id: chat, video: draft.media_file_id, caption: previewCaption });
      else await tg(e, "sendDocument", { chat_id: chat, document: draft.media_file_id, caption: previewCaption });
    } catch {
      await say(e, chat, "⚠️ Telegram could not preview the service attachment. The draft remains unsent; check the attachment before using Send.");
    }
  }
  const summary = serviceDeliveryDraftSummary(draft, order, options.heading) + (options.note ? "\n\n" + esc(options.note) : "");
  return say(e, chat, summary, serviceDeliveryKeyboard(draft.id));
}

async function createOrReopenServiceDeliveryDraft(
  e: Env,
  actor: string,
  chat: string | number,
  order: CustomerOrder,
  initialBody = "",
  media?: ReceiptMedia
) {
  if (order.kind !== "service") return say(e, chat, "That reference is a profile request, not a service order. Use Prepare delivery for profile requests. Nothing was sent.");
  if (order.status !== "payment_verified") return say(e, chat, "Service fulfilment requires a manually verified payment first. This order is currently <b>" + esc(order.status) + "</b>. Nothing was sent.");
  const body = String(initialBody || "").trim();
  if (body.length > SERVICE_DELIVERY_TEXT_LIMIT) return say(e, chat, "Service fulfilment text is too long. Keep it to " + SERVICE_DELIVERY_TEXT_LIMIT + " characters or fewer. Nothing was sent.");

  const existing = await e.DB.prepare("SELECT id,status FROM service_delivery_drafts WHERE service_order_id=?").bind(order.id).first<any>();
  if (existing && (existing.status === "sent" || existing.status === "sending")) {
    return say(e, chat, inactiveDraftMessage(existing.status, "The service fulfilment draft for this order") + " Inspect /drafts and the customer conversation before any recovery action.");
  }

  const conflicts = await adminComposerConflicts(e, actor, { kind: "service_delivery", orderId: order.id, orderKind: "service" });
  if (conflicts.length) return replyAdminComposerConflict(e, chat, conflicts, "opening this service fulfilment composer");

  const draftId = existing?.id || crypto.randomUUID();
  if (existing) {
    const current = await loadServiceDeliveryDraft(e, draftId);
    const preserveCurrent = Boolean(current && current.status === "draft" && !isDraftExpired(current.expires_at));
    const updated = await e.DB.prepare("UPDATE service_delivery_drafts SET admin_telegram_id=?,message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,status='draft',expires_at=datetime('now','+30 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('draft','cancelled','expired')")
      .bind(
        actor,
        body || (preserveCurrent ? current?.message_text || "" : ""),
        media?.kind || (preserveCurrent ? current?.media_kind || null : null),
        media?.fileId || (preserveCurrent ? current?.media_file_id || null : null),
        media?.mimeType || (preserveCurrent ? current?.media_mime_type || null : null),
        draftId
      )
      .run();
    if (!updated.meta?.changes) return say(e, chat, "Could not reopen the service draft because its state changed. Nothing was sent.");
  } else {
    await e.DB.prepare("INSERT INTO service_delivery_drafts(id,service_order_id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at) VALUES(?,?,?,?,?,?,?,'draft',datetime('now','+30 minutes'))")
      .bind(draftId, order.id, actor, body, media?.kind || null, media?.fileId || null, media?.mimeType || null)
      .run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_delivery_draft_created',?,?)")
      .bind(actor, order.id, "Admin created service fulfilment draft; no customer message sent; media=" + (media ? media.kind : "none") + "; text_length=" + body.length)
      .run();
  }

  const racedConflicts = await adminComposerConflicts(e, actor, { kind: "service_delivery", draftId });
  if (racedConflicts.length) {
    await e.DB.prepare("UPDATE service_delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId, actor).run();
    return replyAdminComposerConflict(e, chat, racedConflicts, "opening this service fulfilment composer");
  }

  const context = await loadServiceDeliveryDraftContext(e, draftId);
  if (!context?.order) return say(e, chat, "The service fulfilment draft could not be reloaded. Nothing was sent.");
  return sendServiceDeliveryDraftSummary(e, chat, context.draft, context.order);
}

async function auditAdminMessageDraft(e: Env, adminTelegramId: string, action: string, draft: AdminMessageDraft, order: CustomerOrder | null, details: string) {
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)")
    .bind(adminTelegramId, action, draft.order_id, order?.kind === "contact" ? (order.target_id || null) : null, details)
    .run();
}

function adminMessageDraftSummary(draft: AdminMessageDraft, order: CustomerOrder, heading?: string): string {
  const purpose = adminMessagePurpose(draft);
  const body = adminMessageBody(draft);
  const outgoingBody = adminMessageOutgoingBody(draft, order);
  const problem = adminMessageSendProblem(draft, order);
  const mediaLabel = draft.media_file_id
    ? "One " + esc(String(draft.media_kind || "file")) + " attached" + (draft.media_mime_type ? " (" + esc(String(draft.media_mime_type)) + ")" : "")
    : "None";
  const messageSection = body
    ? esc(outgoingBody)
    : draft.media_file_id
      ? purpose === "rejection"
        ? esc(outgoingBody)
        : "<i>Media only — no message text.</i>"
      : "<i>No text or attachment yet. Send text and/or one photo/document in this private chat.</i>";
  const lines = [
    heading || (purpose === "rejection" ? "🚫 <b>Rejection follow-up draft</b>" : "💬 <b>Customer support draft</b>"),
    "Purpose: <b>" + (purpose === "rejection" ? "Reject this pending order and message the client" : "Customer support") + "</b>",
    "Order type: <b>" + (order.kind === "contact" ? "Request" : "Service order") + "</b>",
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
  lines.push("", purpose === "rejection"
    ? "<i>Preview only — nothing has been sent and the order is <b>not rejected yet</b>. Draft expires at " + esc(String(draft.expires_at || "unknown")) + " UTC. Tapping <b>Reject &amp; send follow-up</b> will reject/cancel this still-pending order and send this message/media. Cancelling this composer leaves the order unchanged.</i>"
    : "<i>Preview only — nothing has been sent. Draft expires at " + esc(String(draft.expires_at || "unknown")) + " UTC. Sending this support message will not change payment, approval, delivery, or fulfilment status.</i>");
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
      } else if (/^video\//i.test(draft.media_mime_type || "")) {
        await tg(e, "sendVideo", { chat_id: chat, video: draft.media_file_id, caption: previewCaption });
      } else {
        await tg(e, "sendDocument", { chat_id: chat, document: draft.media_file_id, caption: previewCaption });
      }
    } catch {
      await say(e, chat, "⚠️ Telegram could not preview the attachment. The draft remains unsent; check the attachment before using Send.");
    }
  }
  const summary = adminMessageDraftSummary(draft, order, options.heading) + (options.note ? "\n\n" + esc(options.note) : "");
  return say(e, chat, summary, adminMessageKeyboard(draft.id, adminMessagePurpose(draft), order));
}

async function createOrReopenAdminMessageDraft(e: Env, m: Msg, rawRef: string, initialBody: string, media?: ReceiptMedia, purpose: AdminMessagePurpose = "support") {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (user !== e.ADMIN_TELEGRAM_ID) return say(e, chat, "Admin access only. Nothing was sent.");
  if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to compose a customer support message. Nothing was sent.");

  const body = String(initialBody || "").trim();
  if (body.length > ADMIN_MESSAGE_TEXT_LIMIT) return say(e, chat, "Support message text is too long. Keep it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer. Nothing was sent.");

  const otherComposers = await adminComposerConflicts(e, user, { kind: "support" });
  if (otherComposers.length) {
    return replyAdminComposerConflict(e, chat, otherComposers, "opening a customer-support composer");
  }

  const resolved = await resolveCustomerOrderReference(e, rawRef);
  if (resolved.error === "invalid") return say(e, chat, "Use a full order UUID or an order code in the format <code>FL-ABC123</code>. Nothing was sent.");
  if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order, so no draft was opened. Use the exact full order UUID after checking the records.");
  if (resolved.error === "missing" || !resolved.order) return say(e, chat, "No request or service order matched that UUID or FL- order code. Nothing was sent.");
  const order = resolved.order;
  if (purpose === "rejection" && order.status !== "pending_payment") {
    return say(e, chat, "This order is no longer pending payment, so a receipt-rejection follow-up was not opened. Inspect the current order before taking another action.", { inline_keyboard: [[{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]] });
  }

  const uncertain = await e.DB.prepare("SELECT id FROM admin_message_drafts WHERE order_kind=? AND order_id=? AND status='sending' ORDER BY updated_at DESC LIMIT 1").bind(order.kind, order.id).first<any>();
  if (uncertain) {
    return say(e, chat, "A previous support message for this order has an uncertain Telegram outcome and is locked to prevent a duplicate. Inspect the customer conversation first, then use /drafts for the audited recovery path if the message definitely was not delivered. Do not blind-retry.");
  }

  const conflictsForOrder = await adminComposerConflicts(e, user, { kind: "support", orderId: order.id, orderKind: order.kind });
  if (conflictsForOrder.length) {
    return replyAdminComposerConflict(e, chat, conflictsForOrder, "opening a customer-support composer for this order");
  }

  const existing = await activeAdminMessageDraft(e, user);
  if (existing && (existing.order_kind !== order.kind || existing.order_id !== order.id)) {
    return say(e, chat, "Finish or cancel the current customer support draft for <code>" + esc(String(existing.checkout_code || existing.order_id)) + "</code> before composing a message for another order.", adminMessageKeyboard(existing.id, adminMessagePurpose(existing)));
  }
  if (existing) {
    if (adminMessagePurpose(existing) !== purpose) {
      return say(e, chat, "A different kind of customer-message draft is already open for this order. Finish or cancel that draft before opening a " + (purpose === "rejection" ? "rejection follow-up" : "support message") + "; its purpose was not changed.", adminMessageKeyboard(existing.id, adminMessagePurpose(existing)));
    }
    if (String(existing.telegram_user_id) !== String(order.telegram_user_id) || String(existing.telegram_chat_id) !== String(order.telegram_chat_id)) {
      return say(e, chat, "The customer destination saved on the existing support draft no longer matches this order. Cancel that draft and inspect the order before composing again.", adminMessageKeyboard(existing.id, adminMessagePurpose(existing)));
    }
    const updated = await e.DB.prepare("UPDATE admin_message_drafts SET checkout_code=?,message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,expires_at=datetime('now','+30 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?")
      .bind(order.checkout_code || null, body || existing.message_text || null, media?.kind || existing.media_kind || null, media?.fileId || existing.media_file_id || null, media?.mimeType || existing.media_mime_type || null, existing.id, user)
      .run();
    if (!updated.meta?.changes) return say(e, chat, "The support draft changed while it was being reopened. Nothing was sent.");
    const context = await loadAdminMessageDraftContext(e, existing.id);
    if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
    return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: purpose === "rejection" ? "🚫 <b>Rejection follow-up draft updated</b>" : "💬 <b>Customer support draft updated</b>" });
  }

  const draftId = crypto.randomUUID();
  try {
    await e.DB.prepare("INSERT INTO admin_message_drafts(id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,purpose,message_text,media_kind,media_file_id,media_mime_type,status,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft',datetime('now','+30 minutes'))")
      .bind(draftId, order.id, order.kind, user, order.telegram_user_id, order.telegram_chat_id, order.checkout_code || null, purpose, body || null, media?.kind || null, media?.fileId || null, media?.mimeType || null)
      .run();
  } catch {
    const raced = await activeAdminMessageDraft(e, user);
    if (raced) return say(e, chat, "Another customer support draft was opened at the same time. Finish or cancel it before composing a different support message.", adminMessageKeyboard(raced.id, adminMessagePurpose(raced)));
    throw new Error("admin_message_draft_create_failed");
  }

  const racedConflicts = await adminComposerConflicts(e, user, { kind: "support", draftId });
  if (racedConflicts.length) {
    await e.DB.prepare("UPDATE admin_message_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId, user).run();
    return replyAdminComposerConflict(e, chat, racedConflicts, "opening a customer-support composer");
  }

  const context = await loadAdminMessageDraftContext(e, draftId);
  if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
  await auditAdminMessageDraft(e, user, purpose === "rejection" ? "admin_rejection_draft_created" : "admin_support_draft_created", context.draft, context.order, "Admin created " + (purpose === "rejection" ? "receipt-rejection follow-up" : "customer support") + " draft for " + order.kind + " order " + String(order.checkout_code || order.id) + "; " + adminMessageContentDetails(context.draft));
  return sendAdminMessageDraftSummary(e, chat, context.draft, context.order);
}

function receiptContextValue(value: unknown, fallback: string, maxLength: number): string {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || fallback;
}

function receiptAdminCaption(order: CustomerOrder, submissionId: string): string {
  const username = receiptContextValue(order.telegram_username, "", 64).replace(/^@+/, "");
  const caption = [
    "<b>Selar receipt submitted for manual review</b>",
    `Submission: <code>${esc(submissionId)}</code>`,
    `Type: ${order.kind === "contact" ? "Request" : "Service order"}`,
    `Order: <code>${esc(order.id)}</code>`,
    `${order.kind === "contact" ? "Profile" : "Service"}: <code>${esc(receiptContextValue(order.target_id, "unknown", 100))}</code>`,
    `Checkout code: <code>${esc(receiptContextValue(order.checkout_code, "not recorded", 32))}</code>`,
    `Checkout name: ${esc(receiptContextValue(order.checkout_name, "not recorded", 120))}`,
    `Saved buyer email clue: ${esc(receiptContextValue(order.buyer_email, "not recorded", 160))}`,
    `Telegram user: <code>${esc(order.telegram_user_id)}</code>${username ? ` (@${esc(username)})` : ""}`,
    "",
    "No matching backend sale was attached when this fallback was used. The receipt is customer-supplied evidence only and has NOT changed the order status.",
    "Use the buttons below after checking Selar: <b>Verify</b> asks for the exact reference if one is not attached; <b>Reject &amp; message</b> opens a follow-up composer; <b>Just reject</b> cancels now and tells the client payment wasn't made."
  ].join("\n");
  if (caption.length <= 1024) return caption;

  // HTML escaping can expand customer-provided clues. Telegram media captions
  // are limited to 1024 characters, so retain the identifiers and button
  // guidance the administrator needs and omit longer reconciliation clues.
  return [
    "<b>Selar receipt submitted for manual review</b>",
    `Submission: <code>${esc(submissionId)}</code>`,
    `Order: <code>${esc(order.id)}</code>`,
    `Checkout code: <code>${esc(receiptContextValue(order.checkout_code, "not recorded", 32))}</code>`,
    `Telegram user: <code>${esc(order.telegram_user_id)}</code>${username ? ` (@${esc(username)})` : ""}`,
    "Receipt evidence only; order status unchanged. Check Selar, then use Verify, Reject &amp; message, or Just reject below."
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
  const language = await customerLanguage(e, user, chat);
  if (chat !== user) return say(e, chat, tr(language, "receiptPrivateOnly"));
  const order = await loadCustomerOrderById(e, preliminaryOrder.id) || preliminaryOrder;
  if (String(order.telegram_user_id) !== user) return say(e, chat, tr(language, "receiptOtherAccount"));
  if (order.status !== "pending_payment") return handlePaidClaim(e, chat, user, order);
  if (!String(order.checkout_name || "").trim()) return handlePaidClaim(e, chat, user, order);

  // Re-check immediately before accepting the receipt: the existing Selar Zap
  // may have attached a sale after the customer was prompted.
  if (await attachedSaleReference(e, order)) return handlePaidClaim(e, chat, user, order);
  if (!e.ADMIN_TELEGRAM_ID) {
    return say(e, chat, tr(language, "receiptReviewNotConfigured"));
  }

  const extracted = extractReceiptMedia(m);
  if (!extracted.media) {
    await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, order.id, order.kind).run();
    return say(e, chat, extracted.unsupportedKey ? tr(language, extracted.unsupportedKey) : (extracted.unsupported || tr(language, "receiptSendSupported")));
  }
  const media = extracted.media;
  const forwarded = await forwardedReceiptForOrder(e, order.id);
  if (forwarded) {
    await clearPaymentPrompts(e, user, order.id);
    return say(e, chat, tr(language, "receiptAlreadySentLong"));
  }

  // A forwarding row left behind by a process interruption can be retried after
  // a short interval; a fresh one means a duplicate update is already in flight.
  await e.DB.prepare("UPDATE payment_receipt_submissions SET status='superseded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE order_id=? AND status='forwarding' AND updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes')").bind(order.id).run();
  const messageId = Number.isSafeInteger(m.message_id) && Number(m.message_id) > 0 ? Number(m.message_id) : null;
  let submission = await findDuplicateReceiptSubmission(e, user, order, messageId, media);
  let submissionId = "";
  if (!submission) {
    const inFlight = await e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE order_id=? AND status='forwarding' LIMIT 1").bind(order.id).first<ReceiptSubmission>();
    if (inFlight) return say(e, chat, tr(language, "receiptForwardingWait"));
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
      return say(e, chat, tr(language, "receiptDuplicateSent"));
    }
    if (submission.status === "forwarding") return say(e, chat, tr(language, "receiptForwardingWait"));
    const claimed = await e.DB.prepare("UPDATE payment_receipt_submissions SET status='forwarding',admin_telegram_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('delivery_failed','superseded')").bind(e.ADMIN_TELEGRAM_ID, submission.id).run();
    if (!claimed.meta?.changes) {
      const latestSubmission = await e.DB.prepare("SELECT id,order_id,status FROM payment_receipt_submissions WHERE id=?").bind(submission.id).first<ReceiptSubmission>();
      if (latestSubmission?.status === "forwarded") {
        await clearPaymentPrompts(e, user, order.id);
        return say(e, chat, tr(language, "receiptDuplicateSent"));
      }
      return say(e, chat, tr(language, "receiptProcessingWait"));
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
      parse_mode: "HTML",
      reply_markup: receiptReviewKeyboard(latestOrder)
    };
    payload[media.kind] = media.fileId;
    await tg(e, media.kind === "photo" ? "sendPhoto" : "sendDocument", payload);
  } catch {
    await e.DB.prepare("UPDATE payment_receipt_submissions SET status='delivery_failed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='forwarding'").bind(submissionId).run();
    await e.DB.prepare("INSERT OR REPLACE INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(user, latestOrder.id, latestOrder.kind).run();
    console.error("Receipt forwarding failed");
    return say(e, chat, tr(language, "receiptForwardFailed"));
  }

  await e.DB.prepare("UPDATE payment_receipt_submissions SET status='forwarded',telegram_file_id='',telegram_file_unique_id=NULL,mime_type=NULL,file_size=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='forwarding'").bind(submissionId).run();
  await clearPaymentPrompts(e, user, latestOrder.id);
  return say(e, chat, tr(language, "receiptSentReview"));
}

async function start(e: Env, m: Msg, payload: string) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id), rawId = payload.replace(/^contact_/, "");
  const language = await customerLanguage(e, user, chat);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(rawId)) return say(e, chat, tr(language, "invalidProfileLink"));
  let profile: Profile | undefined;
  try {
    const profiles = await catalogue(e);
    // Telegram start parameters only allow [A-Za-z0-9_-], so the website encodes "."
    // in profile IDs as "_dot_" (e.g. emanuela.ebony -> contact_emanuela_dot_ebony).
    // Exact catalogue matches win; the decoded form is only a fallback lookup.
    profile = profiles.find(p => p.id === rawId) || profiles.find(p => p.id === rawId.replace(/_dot_/g, "."));
  }
  catch { return say(e, chat, tr(language, "catalogueUnavailable")); }
  if (!profile) return say(e, chat, tr(language, "profileNotListed"));
  if (enabledMethods(e).length === 0) {
    await say(e, chat, tr(language, "paymentsNotReady"));
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
    const keyboard = { inline_keyboard: (rows.results || []).map(r => [{ text: tr(language, "checkButton", { code: String(r.checkout_code || tr(language, "requestWord")) }), callback_data: `paid:${r.id}` }]) };
    return say(e, chat, tr(language, "threeRequestsAwaiting"), keyboard);
  }
  const requestId = crypto.randomUUID();
  let code = "";
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    try {
      code = await generateUniqueCheckoutCode(e.DB);
    } catch {
      await notifyAdminIfConfigured(e, "Alert: Checkout code generation exhausted retries for request.");
      return say(e, chat, tr(language, "orderCodeGenerationFailed"));
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
      if (raced) return say(e, chat, tr(language, "existingRequestRace"));
    }
  }
  if (!inserted) return say(e, chat, tr(language, "requestStartFailed"));
  const greeting = tr(language, "profileGreeting", { profileName: esc(profile.name), code: esc(code), exactCodeInstruction: tr(language, "exactCodeNoTrailingSpace") });
  return say(e, chat, greeting, paymentKeyboard(e, requestId, language));
}

async function aiReply(e: Env, chat: string, userText: string, reminder = "", voiceReply = false) {
  const isAdminChat = Boolean(e.ADMIN_TELEGRAM_ID && String(chat) === String(e.ADMIN_TELEGRAM_ID));
  const language = isAdminChat ? "en" : await customerLanguageForChat(e, chat);
  // Plain AI chat replies carry the website/channel navigation buttons.
  // Deterministic workflow/action messages elsewhere keep their own buttons,
  // and the admin's own chat never gets customer navigation.
  const navMarkup = isAdminChat ? undefined : customerNavKeyboard(e, language);
  if (!e.AI) return say(e, chat, reminder || tr(language, "aiHelpFallback"), navMarkup);
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
        { role: "system", content: "You are Annie, a warm, natural, helpful assistant for the requests and services available through this chat. Your main job is to help customers understand their requests, service orders, checkout, billing, and payment status. Do not introduce yourself as an AI or use a business brand name; if a name is needed, say “I'm Annie.” Never mention the payment provider by name. Use simple customer wording such as “Pay now,” “checkout,” “payment page,” and “service checkout.” Be playfully flirty and a little cheeky when appropriate, using varied greetings such as “Hey handsome,” “babe,” “darling,” or “hot boy” and a few fitting emojis; do not repeat the same opening every time. Keep it respectful and non-explicit, and never let playful tone change payment facts or safety instructions. Keep payment discussions about services and requests offered through this chat. In this bot context, words like “pay,” “account,” “Telegram account,” “checkout,” or “pay now” should refer to the customer's current request or service order unless they clearly say otherwise. Do not suggest paying Telegram, an external account, a creator, or a third-party seller. If the intended in-chat service is genuinely unclear, ask one short clarification. Use the read-only context about this Telegram user's own requests and service orders to answer questions about their specific order; name the relevant FL code and explain the next step when useful. For an existing profile/request order, tell the customer to use its Pay now button. For a service order that is still being described, help them clarify the service; when they are ready to pay, tell them to type PAY to receive the service checkout. If they want another request, explain the three-unpaid-request limit only when their saved requests show they have reached it. Mention “I've paid — check again” only when payment checking is relevant. Never claim an administrator is reviewing a payment unless the saved state or attached sale reference supports that. Never promise an ETA. You cannot execute commands, SQL, payment verification, approval, or delivery; deterministic handlers perform permitted actions. Never claim payment received, verified, approved, or fulfilled unless the saved status says so. Never invent profile, payment, service, or creator information. Never reveal or invent a creator's Telegram username, phone number, or private contact details. Never ask for passwords, card PINs, bank credentials, or OTPs. Refer to a “request” rather than “contact request” in customer-facing explanations. Keep replies concise, natural, and plain text. " + aiLanguageInstruction(language) },
        { role: "user", content: `Customer message: ${userText.slice(0, 1500)}\\nRead-only request history: ${history.slice(0, 3500)}` }
      ]
    });
    const answer = String(result?.response || "").trim().slice(0, 3500);
    return say(e, chat, answer ? esc(answer) : (reminder || tr(language, "aiCouldNotAnswer")), navMarkup);
  } catch (err) {
    console.error("AI support reply failed", String(err));
    return say(e, chat, reminder || tr(language, "aiCannotAnswer"), navMarkup);
  }
}

type AdminAssistantIntent = {
  action: string;
  ref?: string | null;
  scope?: OrderDeletionScope | null;
  text?: string | null;
  instruction?: string | null;
};

const ADMIN_ASSISTANT_ACTIONS = new Set([
  "inspect_order",
  "delete_order",
  "clear_orders",
  "close_pending_orders",
  "reject_order",
  "prepare_delivery",
  "message_customer",
  "broadcast",
  "list_orders",
  "list_requests",
  "list_drafts",
  "list_profiles",
  "open_admin_desk",
  "verify_payment",
  "hide_profile",
  "none"
]);

function looksLikeAdminAssistantTask(text: string): boolean {
  return /\bFL-[A-Z0-9]{6}\b/i.test(text)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)
    || /\b(delete|remove|clear|close|expire|reject|message|send|broadcast|write|craft|draft|compose|show|list|inspect|find|open|deliver|fulfil|fulfill|prepare|order|orders|request|requests|customer|customers|client|clients|draft|drafts|profile|profiles|admin desk|verify|payment)\b/i.test(text);
}

async function craftAdminMessageText(e: Env, instruction: string, maxLength: number, audienceLabel: string): Promise<string> {
  if (!e.AI) return "";
  try {
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: "You write short, clear, friendly customer messages for a Telegram admin to send to " + audienceLabel + ". Follow the admin's brief exactly. Plain text only: no HTML, no markdown, and no placeholders such as [Name]. Do not invent prices, links, dates, order facts, refunds, or delivery details that are not in the brief. Do not claim a payment was verified, approved, refunded, or delivered unless the brief explicitly says so. Keep it under " + maxLength + " characters. Output only the message text."
        },
        { role: "user", content: String(instruction || "").slice(0, 1200) }
      ]
    });
    let crafted = String((result as any)?.response || "").trim();
    if ((crafted.startsWith('"') && crafted.endsWith('"')) || (crafted.startsWith("'") && crafted.endsWith("'"))) crafted = crafted.slice(1, -1).trim();
    return crafted.slice(0, maxLength).trim();
  } catch (error) {
    console.error("Admin assistant message drafting failed", String(error));
    return "";
  }
}

async function classifyAdminAssistantIntent(e: Env, text: string): Promise<AdminAssistantIntent | null> {
  if (!e.AI) return null;
  try {
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: "You are a strict intent classifier for a Telegram admin bot. The user is the verified admin. Classify the admin message into exactly one action from this allowlist and reply with ONLY a compact JSON object, no prose and no code fences: {\"action\":\"...\",\"ref\":\"FL-XXXXXX or full order UUID or null\",\"scope\":\"pending|finished|all|null\",\"text\":\"literal message text to use, or null\",\"instruction\":\"what to write when the admin asks you to compose wording, or null\"}. Actions: inspect_order, delete_order, clear_orders, close_pending_orders, reject_order, prepare_delivery, message_customer, broadcast, list_orders, list_requests, list_drafts, list_profiles, open_admin_desk, verify_payment, hide_profile, none. delete_order and clear_orders mean preparing PERMANENT deletion. close_pending_orders is only for close or expire pending wording, not delete or clear wording. message_customer requires an order ref. For message_customer and broadcast, put exact literal wording in text; if the admin asks you to write, compose, or craft wording, put that brief in instruction instead. If the admin asks to verify or confirm a payment, use verify_payment. If the admin asks to delete, hide, or remove a profile, use hide_profile. Never invent an order ref; copy it exactly from the message or use null. If this is not a clear admin task, use none."
        },
        { role: "user", content: String(text || "").slice(0, 1500) }
      ]
    });
    const raw = String((result as any)?.response || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const action = String(parsed.action || "").trim().toLowerCase();
    if (!ADMIN_ASSISTANT_ACTIONS.has(action)) return null;
    const rawRef = String(parsed.ref || parsed.orderRef || parsed.orderCode || parsed.orderId || "").trim().slice(0, 128);
    const ref = /^FL-[A-Z0-9]{6}$/i.test(rawRef)
      ? rawRef.toUpperCase()
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawRef)
        ? rawRef.toLowerCase()
        : rawRef || null;
    const rawScope = String(parsed.scope || "").trim().toLowerCase();
    const scope = rawScope === "pending" || rawScope === "finished" || rawScope === "all" ? rawScope as OrderDeletionScope : null;
    const literalText = String(parsed.text || parsed.message || "").trim().slice(0, 3500);
    const instruction = String(parsed.instruction || parsed.brief || "").trim().slice(0, 1500);
    return {
      action,
      ref,
      scope,
      text: literalText || null,
      instruction: instruction || null
    };
  } catch (error) {
    console.error("Admin assistant classification failed", String(error));
    return null;
  }
}

function adminAssistantOrderRef(intent: AdminAssistantIntent): string | null {
  const ref = String(intent.ref || "").trim();
  if (/^FL-[A-Z0-9]{6}$/i.test(ref)) return ref.toUpperCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return ref.toLowerCase();
  return null;
}

async function resolveAdminAssistantOrder(e: Env, chat: string | number, intent: AdminAssistantIntent): Promise<CustomerOrder | null> {
  const ref = adminAssistantOrderRef(intent);
  if (!ref) {
    await say(e, chat, "I can prepare that, but I need the exact FL- order code or full order UUID. Nothing was changed or sent.");
    return null;
  }
  const resolved = await resolveCustomerOrderReference(e, ref);
  if (resolved.error === "ambiguous") {
    await say(e, chat, "That reference matches more than one order, so I did not prepare anything. Inspect the exact full order UUID with /order ORDER_UUID.");
    return null;
  }
  if (!resolved.order) {
    await say(e, chat, "No profile request or service order matched that exact reference. Nothing was changed or sent.");
    return null;
  }
  return await loadCustomerOrderByKind(e, resolved.order.kind, resolved.order.id) || resolved.order;
}

async function openAssistantBroadcastDraft(e: Env, actor: string, chat: string | number, body: string, crafted: boolean) {
  if (body.length > 900) return say(e, chat, "Broadcast text must be 900 characters or fewer. Nothing was sent.");
  const active = await activeBroadcastDraft(e, actor);
  if (active?.status === "sending") {
    const counts = await broadcastRecipientCounts(e, active.id);
    if (counts.total) {
      return say(e, chat, "📣 <b>A broadcast is already in progress.</b>\n" + formatBroadcastRecipientCounts(counts) + "\nCompleted clients will not receive duplicates. Continue the next saved batch or stop the remaining clients.", broadcastProgressKeyboard(active.id));
    }
    return say(e, chat, "⚠️ A broadcast is already sending or has an uncertain outcome. Use /drafts to inspect it before any recovery; do not blind-retry.");
  }
  if (active?.status === "draft") {
    if (!body) {
      return say(e, chat, "You already have the one open broadcast composer. Send text to update it, attach one photo/video/document, preview it, or use /broadcastcancel.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + active.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + active.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + active.id }]] });
    }
    const updated = await e.DB.prepare("UPDATE admin_broadcast_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(body, active.id, actor).run();
    if (!updated.meta?.changes) return say(e, chat, "The broadcast draft changed while it was being updated. Nothing was sent.");
    return say(e, chat, "📝 Broadcast text updated" + (crafted ? " by the Admin Assistant" : "") + ". Nothing has been sent.\n\nText:\n" + esc(body), { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + active.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + active.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + active.id }]] });
  }
  const conflicts = await adminComposerConflicts(e, actor, { kind: "broadcast" });
  if (conflicts.length) return replyAdminComposerConflict(e, chat, conflicts, "opening a broadcast composer");
  const id = crypto.randomUUID();
  try {
    await e.DB.prepare("INSERT INTO admin_broadcast_drafts(id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at) VALUES(?,?,?,NULL,NULL,NULL,'draft',datetime('now','+30 minutes'))").bind(id, actor, body || null).run();
  } catch {
    const raced = await activeBroadcastDraft(e, actor);
    if (raced?.status === "draft") return say(e, chat, "A broadcast composer was opened at the same time. Use that one composer; no second draft was created.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + raced.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + raced.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + raced.id }]] });
    throw new Error("admin_assistant_broadcast_draft_create_failed");
  }
  const racedConflicts = await adminComposerConflicts(e, actor, { kind: "broadcast", draftId: id });
  if (racedConflicts.length) {
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(id, actor).run();
    return replyAdminComposerConflict(e, chat, racedConflicts, "opening a broadcast composer");
  }
  return say(e, chat, "📣 <b>Broadcast draft created</b>" + (crafted ? " by the Admin Assistant" : "") + "\nAudience: every unique saved client chat from profile requests and service orders, excluding your admin chat. Delivery is batched with a saved per-client ledger so nobody is sent the same broadcast twice.\n\nText: " + (body ? esc(body) : "No message text yet. Send text or attach media.") + "\nMedia: none\n\nNothing has been sent. Preview and confirm when ready.", {
    inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + id }]]
  });
}

async function handleAdminAssistant(e: Env, m: Msg, rawText: string, voiceReply: boolean): Promise<boolean> {
  const chat = String(m.chat.id);
  const actor = String(m.from?.id ?? m.chat.id);
  if (actor !== e.ADMIN_TELEGRAM_ID || chat !== actor) return false;
  const text = String(rawText || "").trim();
  if (!text || text.startsWith("/")) return false;

  // These forbidden intents stay deterministic and manual even if AI is unavailable.
  if (/\b(?:delete|hide|remove)\b[^.!?\n]*\bprofile\b/i.test(text) || /\bprofile\b[^.!?\n]*\b(?:delete|hide|remove)\b/i.test(text)) {
    await say(e, chat, "Profile deletion/hiding is not an AI or natural-language action, so nothing was changed. To reversibly hide a profile yourself, use <code>/hideprofile PROFILE_ID</code> and confirm. Permanent removal requires a website source change and redeployment.");
    return true;
  }
  if (/^\s*(?:please\s+)?(?:verify|confirm)\b[^.!?\n]*\b(?:payment|paid|Selar|order|FL-[A-Z0-9]{6})\b/i.test(text)) {
    await say(e, chat, "I can't verify or confirm payments. Check the sale yourself in Selar, then use the order's <b>Verify</b> button or <code>/order CODE_OR_UUID</code> for the manual verification path. Nothing was verified or changed.");
    return true;
  }

  if (!looksLikeAdminAssistantTask(text) || !e.AI) return false;
  const intent = await classifyAdminAssistantIntent(e, text);
  if (!intent || intent.action === "none") return false;

  if (intent.action === "verify_payment") {
    await say(e, chat, "I can't verify or confirm payments. Check the sale yourself in Selar, then use the order's <b>Verify</b> button or <code>/order CODE_OR_UUID</code> for the manual verification path. Nothing was verified or changed.");
    return true;
  }
  if (intent.action === "hide_profile") {
    await say(e, chat, "Profile deletion/hiding is not an AI or natural-language action, so nothing was changed. To reversibly hide a profile yourself, use <code>/hideprofile PROFILE_ID</code> and confirm. Permanent removal requires a website source change and redeployment.");
    return true;
  }

  if (voiceReply && ["delete_order", "clear_orders", "close_pending_orders", "reject_order"].includes(intent.action)) {
    await say(e, chat, "I will not prepare that consequential admin action from a voice transcript. Type the request or use the Admin Desk buttons so the exact target is deliberate.");
    return true;
  }

  if (intent.action === "inspect_order") {
    const order = await resolveAdminAssistantOrder(e, chat, intent);
    if (!order) return true;
    await sendAdminOrderInspection(e, chat, order, true);
    return true;
  }

  if (intent.action === "delete_order") {
    const ref = adminAssistantOrderRef(intent);
    if (!ref) {
      await say(e, chat, "I can prepare permanent deletion, but I need the exact FL- order code or full order UUID. Nothing was deleted.");
      return true;
    }
    await prepareOrderDeletionByReference(e, actor, chat, ref);
    return true;
  }

  if (intent.action === "clear_orders") {
    if (intent.scope) await prepareBulkOrderDeletion(e, actor, chat, intent.scope);
    else await sendClearOrdersScopeChooser(e, actor, chat);
    return true;
  }

  if (intent.action === "close_pending_orders") {
    await prepareClosePendingOrders(e, actor, chat);
    return true;
  }

  if (intent.action === "reject_order") {
    const order = await resolveAdminAssistantOrder(e, chat, intent);
    if (!order) return true;
    await sendAdminOrderInspection(e, chat, order, true);
    await say(e, chat, "I opened the inspection only — <b>nothing was rejected</b>. After checking it, use the inspection's rejection controls or <code>/reject " + esc(String(order.checkout_code || order.id)) + "</code> when you deliberately want to reject/cancel it.");
    return true;
  }

  if (intent.action === "prepare_delivery") {
    const order = await resolveAdminAssistantOrder(e, chat, intent);
    if (!order) return true;
    if (order.status !== "payment_verified") {
      await say(e, chat, (order.kind === "contact" ? "Request" : "Service order") + " <code>" + esc(String(order.checkout_code || order.id)) + "</code> is currently <b>" + esc(order.status) + "</b>. Fulfilment preparation requires manual payment verification first.");
      return true;
    }
    await sendPrepareFulfilmentPrompt(e, chat, order);
    return true;
  }

  if (intent.action === "message_customer") {
    const order = await resolveAdminAssistantOrder(e, chat, intent);
    if (!order) return true;
    let body = String(intent.text || "").trim();
    let crafted = false;
    if (!body && intent.instruction) {
      body = await craftAdminMessageText(e, intent.instruction, ADMIN_MESSAGE_TEXT_LIMIT, "one customer");
      crafted = Boolean(body);
      if (!body) {
        await say(e, chat, "I couldn't draft that customer message just now. Use <code>/message " + esc(String(order.checkout_code || order.id)) + " Your message</code> instead. Nothing was sent.");
        return true;
      }
    }
    if (body.length > ADMIN_MESSAGE_TEXT_LIMIT) {
      await say(e, chat, "That customer message is too long. Keep it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer. Nothing was sent.");
      return true;
    }
    if (crafted) await say(e, chat, "🤖 I drafted this customer message for your review. Nothing has been sent.");
    await createOrReopenAdminMessageDraft(e, m, order.id, body);
    return true;
  }

  if (intent.action === "broadcast") {
    let body = String(intent.text || "").trim();
    let crafted = false;
    if (!body && intent.instruction) {
      body = await craftAdminMessageText(e, intent.instruction, 900, "all clients");
      crafted = Boolean(body);
      if (!body) {
        await say(e, chat, "I couldn't draft that broadcast just now. Use <code>/broadcast Your message</code> instead. Nothing was sent.");
        return true;
      }
    }
    if (body.length > 900) {
      await say(e, chat, "Broadcast text must be 900 characters or fewer. Nothing was sent.");
      return true;
    }
    await openAssistantBroadcastDraft(e, actor, chat, body, crafted);
    return true;
  }

  if (intent.action === "list_requests") {
    const rows = await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 12").all<any>();
    const buttons = (rows.results || []).map(r => [{ text: (r.status === "payment_verified" ? "🟢 Paid — review approval" : "🟡 Check payment") + " · " + String(r.checkout_code || "request"), callback_data: "admin:request:" + r.id }]);
    await say(e, chat, "<b>Requests needing attention</b>\nChoose a request to review its saved status. A sale notification is not payment verification.", { inline_keyboard: [...buttons, [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
    return true;
  }

  if (intent.action === "list_orders") {
    const rows = await e.DB.prepare("SELECT id,service_id,status,checkout_code,payment_reference FROM service_orders ORDER BY created_at DESC LIMIT 12").all<any>();
    const buttons = (rows.results || []).map(r => [{
      text: (r.status === "payment_verified" ? "🟢 Ready to fulfil" : r.status === "pending_payment" ? "🟡 Check payment" : "🧾 Inspect") + " · " + String(r.checkout_code || "service order"),
      callback_data: "admin:service:" + r.id
    }]);
    await say(e, chat, "<b>Recent service orders</b>\nChoose an order to inspect its saved status, payment evidence, drafts, and customer request text. A sale notification is not payment verification. For older/searchable records use /orders SEARCH or /order CODE_OR_UUID.", { inline_keyboard: [...buttons, [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
    return true;
  }

  if (intent.action === "list_drafts") {
    await say(e, chat, "📝 Tap below to load the current editable and locked drafts.", { inline_keyboard: [[{ text: "📝 Load drafts", callback_data: "admin:drafts" }], [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
    return true;
  }

  if (intent.action === "list_profiles") {
    try {
      const profiles = await catalogue(e);
      if (!profiles.length) {
        await say(e, chat, "No visible website profiles are currently loaded.");
        return true;
      }
      const lines = profiles.slice(0, 30).map(profile => "• <b>" + esc(profile.name) + "</b> · <code>" + esc(profile.id) + "</code>");
      await say(e, chat, "<b>Visible website profiles (" + profiles.length + ")</b>\n" + lines.join("\n") + (profiles.length > 30 ? "\n…showing the first 30. Use /profiles SEARCH for the rest." : ""));
    } catch {
      await say(e, chat, "I couldn't load the live website profile catalogue just now. Try /profiles again shortly.");
    }
    return true;
  }

  if (intent.action === "open_admin_desk") {
    await say(e, chat, "<b>Admin Desk</b>\nChoose an action:", {
      inline_keyboard: [
        [{ text: "📥 Review requests", callback_data: "admin:pending" }],
        [{ text: "🧾 Review service orders", callback_data: "admin:orders" }],
        [{ text: "📝 Drafts & recovery", callback_data: "admin:drafts" }],
        [{ text: "📣 Broadcast to all clients", callback_data: "admin:broadcast_help" }],
        [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }],
        [{ text: "🗑️ Clear orders permanently", callback_data: "admin:clear_orders" }],
        [{ text: "🤖 Admin assistant (AI tasks)", callback_data: "admin:assistant_help" }],
        [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]
      ]
    });
    return true;
  }

  return false;
}

async function servicesMenu(e: Env, chat: string | number) {
  const language = await customerLanguageForChat(e, chat);
  const siteUrl = (e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "");
  return say(e, chat, tr(language, "servicesMenu"), {
    inline_keyboard: [
      [{ text: tr(language, "visitWebsite"), url: siteUrl }],
      [{ text: tr(language, "joinNowSubscribe"), callback_data: "services:join" }]
    ]
  });
}

async function cancelCustomerServiceOrder(e: Env, chat: string | number, user: string, id: string) {
  const language = await customerLanguage(e, user, chat);
  const order = await e.DB.prepare("SELECT id,telegram_user_id,telegram_chat_id,checkout_code,status,payment_reference FROM service_orders WHERE id=?").bind(id).first<any>();
  if (!order || String(order.telegram_user_id) !== user || String(order.telegram_chat_id) !== String(chat)) {
    return say(e, chat, tr(language, "cancelOrderNotFound"));
  }
  if (!["pending_payment", "awaiting_request", "awaiting_email"].includes(String(order.status))) {
    return say(e, chat, tr(language, "cancelOrderNotUnpaid"));
  }
  if (order.payment_reference) {
    return say(e, chat, tr(language, "cancelOrderPaymentAttached"));
  }
  await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, id).run();
  await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=?").bind(user, id).run();
  await e.DB.prepare("DELETE FROM payment_receipt_submissions WHERE order_id=?").bind(id).run();
  await e.DB.prepare("DELETE FROM service_delivery_drafts WHERE service_order_id=?").bind(id).run();
  await e.DB.prepare("DELETE FROM processed_sales WHERE request_id=?").bind(id).run();
  const deleted = await e.DB.prepare("DELETE FROM service_orders WHERE id=? AND telegram_user_id=? AND payment_reference IS NULL AND status IN('pending_payment','awaiting_request','awaiting_email')").bind(id, user).run();
  if (!deleted.meta?.changes) return say(e, chat, tr(language, "cancelOrderChanged"));
  await say(e, chat, tr(language, "cancelOrderDeleted", { code: esc(String(order.checkout_code || id)) }));
  return servicesMenu(e, chat);
}

async function startChannelSubscription(e: Env, m: Msg, forceNew = false) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  const language = await customerLanguage(e, user, chat);
  if (!e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || provider(e) !== "selar") {
    return say(e, chat, tr(language, "channelCheckoutNotReady"));
  }

  const pending = await e.DB.prepare("SELECT id,checkout_code,status,service_id,created_at,payment_reference FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment') ORDER BY created_at DESC LIMIT 3").bind(user).all<any>();
  const pendingRows = pending.results || [];
  if (!forceNew && pendingRows.length) {
    const lines = [tr(language, "previousOrdersHeading"), "", tr(language, "previousOrdersIntro")];
    const buttons: Record<string, unknown>[][] = [];
    for (const row of pendingRows) {
      lines.push("", tr(language, "previousOrderBlock", {
        code: esc(String(row.checkout_code || tr(language, "notAssigned"))),
        status: row.payment_reference ? tr(language, "paymentRecordFoundWaiting") : esc(orderStatusLabel(language, String(row.status))),
        createdAt: esc(String(row.created_at || tr(language, "unknown")))
      }));
      if (!row.payment_reference) buttons.push([{ text: tr(language, "cancelButton", { code: String(row.checkout_code || tr(language, "orderWord")) }), callback_data: "order:cancel:" + String(row.id) }]);
      else buttons.push([{ text: tr(language, "checkButton", { code: String(row.checkout_code || tr(language, "paymentWord")) }), callback_data: "paid:" + String(row.id) }]);
    }
    if (pendingRows.length < 3) buttons.push([{ text: tr(language, "continueNewOrder"), callback_data: "services:continue" }]);
    lines.push("", pendingRows.length >= 3 ? tr(language, "previousOrdersLimitNote") : tr(language, "previousOrdersRoomNote"));
    return say(e, chat, lines.join("\n"), { inline_keyboard: buttons });
  }

  if (!forceNew && !pendingRows.length) {
    const previous = await e.DB.prepare("SELECT id,checkout_code,status,service_id,created_at FROM service_orders WHERE telegram_user_id=? AND status IN('payment_verified','fulfilled') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (previous) {
      const completedWord = String(previous.status) === "fulfilled" ? tr(language, "previousCompletedWord") : tr(language, "previousVerifiedWord");
      return say(e, chat, tr(language, "welcomeBackPrevious", {
        completedWord,
        code: esc(String(previous.checkout_code || tr(language, "notAssigned"))),
        status: esc(orderStatusLabel(language, String(previous.status)))
      }), {
        inline_keyboard: [[{ text: tr(language, "startAgain"), callback_data: "services:restart" }]]
      });
    }
  }
  if (pendingRows.length >= 3) {
    const buttons = pendingRows.map((row: any) => row.payment_reference
      ? [{ text: tr(language, "checkButton", { code: String(row.checkout_code || tr(language, "paymentWord")) }), callback_data: "paid:" + String(row.id) }]
      : [{ text: tr(language, "cancelButton", { code: String(row.checkout_code || tr(language, "orderWord")) }), callback_data: "order:cancel:" + String(row.id) }]);
    return say(e, chat, tr(language, "limitThreeOrders"), { inline_keyboard: buttons });
  }

  let code = "";
  try { code = await generateUniqueCheckoutCode(e.DB); }
  catch { return say(e, chat, tr(language, "prepareCheckoutFailed")); }
  const id = crypto.randomUUID();
  try {
    await e.DB.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,payment_method,checkout_code,request_text) VALUES(?,?,?,?,?,'pending_payment','selar',?,?)")
      .bind(id, "telegram_channel", user, chat, m.from?.username || "", code, "Telegram channel subscription from bot services menu").run();
  } catch { return say(e, chat, tr(language, "startSubscriptionFailed")); }
  const checkout = new URL(e.SERVICE_CHECKOUT_URL);
  checkout.searchParams.set("add_to_cart", "1");
  return say(e, chat, tr(language, "channelCheckoutInstructions", { code: esc(code), exactCodeInstruction: tr(language, "exactCodeNoTrailingSpace") }), {
    inline_keyboard: [
      [{ text: tr(language, "payNow"), url: checkout.toString() }],
      [{ text: tr(language, "copyUniqueCode"), callback_data: "copycode:" + id }],
      [{ text: tr(language, "doneCheckoutCompleted"), callback_data: "done:" + id }],
      [{ text: tr(language, "paidCheckAgain"), callback_data: "paid:" + id }]
    ]
  });
}

async function startService(e: Env, m: Msg, serviceId: string) {
  if (serviceId === "telegram_channel") return startChannelSubscription(e, m);
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  const language = await customerLanguage(e, user, chat);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(serviceId)) return say(e, chat, tr(language, "invalidServiceLink"));
  if (!e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || provider(e) !== "selar") {
    await say(e, chat, tr(language, "serviceNotReady"));
    await notifyAdminIfConfigured(e, "Service purchase setup required: configure the service Selar checkout URL and product code.");
    return;
  }
  // Service orders and creator contact requests are independent purchases.
  const active = await e.DB.prepare("SELECT id,checkout_code,status,service_id,request_text FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  if (active) return say(e, chat, tr(language, "existingServiceOrder", {
    code: esc(String(active.checkout_code || tr(language, "notAssigned"))),
    status: esc(orderStatusLabel(language, String(active.status)))
  }));
  const id = crypto.randomUUID();
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    let code: string;
    try {
      code = await generateUniqueCheckoutCode(e.DB);
    } catch {
      await notifyAdminIfConfigured(e, "Alert: Service checkout code generation exhausted retries for service order.");
      return say(e, chat, tr(language, "orderCodeGenerationFailed"));
    }
    try {
      await e.DB.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,checkout_code) VALUES(?,?,?,?,?,'awaiting_request',?)").bind(id, serviceId, user, chat, m.from?.username || "", code).run();
      inserted = true;
    } catch {
      let raced: unknown = null;
      try { raced = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first(); } catch { /* fall through to the failure message below */ }
      if (raced) return say(e, chat, tr(language, "alreadyServiceOrderOpen"));
    }
  }
  if (!inserted) return say(e, chat, tr(language, "serviceStartFailed"));
  return say(e, chat, tr(language, "serviceWelcome", { orderId: id }));
}

async function manuallyVerifyOrderByReference(e: Env, actor: string, chat: string | number, isService: boolean, rawOrderId: string, rawReference: string): Promise<void> {
  if (actor !== e.ADMIN_TELEGRAM_ID || String(chat) !== actor) {
    await say(e, chat, "Admin private chat only. Nothing was changed.");
    return;
  }
  const oid = String(rawOrderId || "").trim().toLowerCase();
  const reference = String(rawReference || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(oid) || !reference || reference.length > 200 || /[\s<>]/.test(reference)) {
    await say(e, chat, isService
      ? "Usage: /verifyservice ORDER_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference."
      : "Usage: /verify REQUEST_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference.");
    return;
  }
  const table = isService ? "service_orders" : "contact_requests";
  const row = await e.DB.prepare(`SELECT id,telegram_chat_id,status,payment_reference,buyer_email,${isService ? "service_id" : "profile_id"} AS target_id FROM ${table} WHERE id=?`).bind(oid).first<any>();
  if (!row) { await say(e, chat, "Order not found. Nothing was changed."); return; }
  await deleteReceiptVerifyPrompt(e, actor, { kind: isService ? "service" : "contact", id: oid });
  if (row.status === "payment_verified" && row.payment_reference === reference) { await say(e, chat, "Already verified with that reference. No change made."); return; }
  if (row.status !== "pending_payment") { await say(e, chat, `Cannot verify: order status is ${esc(String(row.status))}. Only pending_payment orders can be verified. Nothing was changed.`); return; }
  if (row.payment_reference && row.payment_reference !== reference) { await say(e, chat, "A different sale reference is already attached to this order. Resolve the mismatch in Selar first. Nothing was changed."); return; }
  const usedSale = await e.DB.prepare("SELECT request_id FROM processed_sales WHERE provider_reference=?").bind(reference).first<any>();
  if (usedSale && String(usedSale.request_id) !== oid) { await say(e, chat, "That reference is already recorded for a different order. Nothing was changed."); return; }
  const usedContact = await e.DB.prepare("SELECT id FROM contact_requests WHERE payment_reference=? AND id<>?").bind(reference, oid).first<any>();
  const usedService = await e.DB.prepare("SELECT id FROM service_orders WHERE payment_reference=? AND id<>?").bind(reference, oid).first<any>();
  if (usedContact || usedService) { await say(e, chat, "That reference is already attached to a different order. Nothing was changed."); return; }
  const productId = isService ? (e.SERVICE_PRODUCT_ID || "") : (e.SELAR_PRODUCT_ID || "");
  if (!productId) { await say(e, chat, "The Selar product code is not configured for this flow. Nothing was changed."); return; }
  const upd = await e.DB.prepare(`UPDATE ${table} SET status='payment_verified',payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'`).bind(reference, oid).run();
  if (!upd.meta?.changes) { await say(e, chat, "Order status changed while verifying. No change made."); return; }
  await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(reference, row.buyer_email || "", 0, "UNK", productId, oid).run();
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)").bind(actor, isService ? "service_payment_admin_verified_manual_reference" : "selar_payment_admin_verified_manual_reference", oid, row.target_id || null, `Admin manually verified after checking Selar directly; reference ${reference}`).run();
  if (isService) {
    const customerLang = await customerLanguageForChat(e, row.telegram_chat_id);
    await sayBestEffort(e, row.telegram_chat_id, tr(customerLang, "paymentConfirmedService"));
    await say(e, chat, "Payment manually verified for service order <code>" + esc(oid) + "</code>. Use /deliver " + esc(oid) + " your service details when ready.");
    return;
  }
  await sayBestEffort(e, row.telegram_chat_id, tr(await customerLanguageForChat(e, row.telegram_chat_id), "paymentConfirmedContact"));
  await say(e, chat, "Payment manually verified for profile request <code>" + esc(oid) + "</code>. Prepare your delivery message/media and explicitly confirm sending when ready.", { inline_keyboard: [[{ text: "📝 Prepare delivery", callback_data: "approve:" + oid }, { text: "Reject", callback_data: "reject:" + oid }]] });
}

async function message(e: Env, m: Msg) {
  let t = (m.text || "").trim();
  const caption = (m.caption || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  // The persistent customer reply-keyboard buttons send their labels as text;
  // normalize every supported language before any prompt can consume them.
  if (user !== e.ADMIN_TELEGRAM_ID && (CUSTOMER_START_BUTTON_TEXTS as readonly string[]).includes(t)) t = "/start";
  else if (user !== e.ADMIN_TELEGRAM_ID && (CUSTOMER_LANGUAGE_BUTTON_TEXTS as readonly string[]).includes(t)) t = "/language";
  const isBroadcastCaption = user === e.ADMIN_TELEGRAM_ID && /^\/broadcast(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(caption);
  const hasReceiptCandidateMedia = Boolean((Array.isArray(m.photo) && m.photo.length > 0) || m.document || m.video);
  if (hasReceiptCandidateMedia && user === e.ADMIN_TELEGRAM_ID && !isBroadcastCaption) {
    if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to manage customer drafts or attach admin media. Nothing was changed or sent.");
    const normalizedCaption = caption.replace(/^(\/[A-Za-z0-9_]+)@[A-Za-z0-9_]+(?=\s|$)/, "$1");
    if (normalizedCaption === "/message" || normalizedCaption.startsWith("/message ")) {
      const command = normalizedCaption.match(/^\/message\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
      if (!command) return say(e, chat, "Caption format: /message FL-ABC123 Your message here. This opens a draft only; it does not send.");
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB. No support draft was opened.");
      return createOrReopenAdminMessageDraft(e, m, command[1], command[2] || "", extracted.media);
    }
    if (normalizedCaption === "/deliver" || normalizedCaption.startsWith("/deliver ")) {
      const command = normalizedCaption.match(/^\/deliver\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
      if (!command) return say(e, chat, "Caption format: /deliver FL-ABC123 Optional fulfilment text. This opens a draft only; it does not send.");
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB. No service draft was opened.");
      const resolved = await resolveCustomerOrderReference(e, command[1]);
      if (resolved.error === "invalid") return say(e, chat, "Use a full service-order UUID or an FL- order code. Nothing was sent.");
      if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order, so no service draft was opened. Use /order ORDER_UUID to inspect the exact record.");
      if (!resolved.order) return say(e, chat, "No service order matched that reference. Nothing was sent.");
      const order = await loadCustomerOrderByKind(e, resolved.order.kind, resolved.order.id) || resolved.order;
      return createOrReopenServiceDeliveryDraft(e, user, chat, order, command[2] || "", extracted.media);
    }

    const editableComposers = await listEditableAdminComposers(e, user);
    if (editableComposers.length > 1) {
      return replyAdminComposerConflict(e, chat, editableComposers, "attaching this media");
    }
    const activeComposer = editableComposers[0] || null;

    const broadcastDraft = await activeBroadcastDraft(e, user);
    if (activeComposer?.kind === "broadcast" && broadcastDraft && broadcastDraft.status === "draft" && broadcastDraft.id === activeComposer.draftId) {
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB.");
      let nextText = String(broadcastDraft.message_text || "").trim();
      let captionNote = nextText ? "Existing broadcast text was kept and will be sent as the media caption." : "No broadcast text is saved yet.";
      if (caption && !caption.startsWith("/")) {
        if (caption.length > 900) return say(e, chat, "The media caption is too long to use as broadcast text, so the media was not attached. Shorten it to 900 characters or fewer.");
        // A Telegram media message's caption is the text sent with that media.
        // Save it with the attachment instead of silently dropping it.
        nextText = caption;
        captionNote = "The media caption was saved as the broadcast text and will be sent with the media.";
      } else if (caption.startsWith("/")) {
        captionNote = "The slash-command caption was not used as broadcast text." + (nextText ? " Existing broadcast text was kept." : "");
      }
      const updated = await e.DB.prepare("UPDATE admin_broadcast_drafts SET message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(nextText || null, extracted.media.kind, extracted.media.fileId, extracted.media.mimeType, broadcastDraft.id, user).run();
      if (!updated.meta?.changes) return say(e, chat, "Broadcast draft changed; media was not attached.");
      return say(e, chat, "📎 <b>Broadcast media attached</b>\nText: " + (nextText ? esc(nextText) : "none") + "\nMedia: " + esc(String(extracted.media.mimeType || extracted.media.kind)) + "\n" + esc(captionNote) + "\n\nNothing has been sent. Preview to see the exact media and caption before confirming.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + broadcastDraft.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + broadcastDraft.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + broadcastDraft.id }]] });
    }
    const deliveryDraft = activeComposer?.kind === "request_delivery" ? await activeDeliveryDraft(e, user) : null;
    const serviceDraft = activeComposer?.kind === "service_delivery" ? await activeServiceDeliveryDraft(e, user) : null;
    const supportDraft = activeComposer?.kind === "support" ? await activeAdminMessageDraft(e, user) : null;
    if (deliveryDraft && deliveryDraft.id === activeComposer?.draftId) {
      const media = extractSupportMedia(m);
      if (!media.media) return say(e,chat,media.unsupported || "Send one photo, video, or PDF/image document.");
      let nextText = deliveryDraft.message_text || null;
      let note = "";
      if (caption && !caption.startsWith("/")) {
        if (caption.length > 700) return say(e, chat, "The media caption is too long to use as delivery text, so the media was not attached. Shorten it to 700 characters or fewer.");
        if (!String(deliveryDraft.message_text || "").trim()) nextText = caption;
        else if (caption !== String(deliveryDraft.message_text)) note = " Existing delivery text was kept; the media caption was not used as message text.";
      } else if (caption.startsWith("/")) {
        note = " The media caption was not used as message text.";
      }
      const updated = await e.DB.prepare("UPDATE delivery_drafts SET message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(nextText,media.media.kind,media.media.fileId,media.media.mimeType,deliveryDraft.id,user).run();
      if (!updated.meta?.changes) return say(e, chat, "The request delivery draft changed while media was being attached. Nothing was sent.");
      return say(e,chat,"📎 Media attached to the profile-request delivery draft for <code>"+esc(deliveryDraft.checkout_code || "request")+"</code>."+note,{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+deliveryDraft.id} ],[ {text:"✅ Send to customer",callback_data:"draft:send:"+deliveryDraft.id},{text:"✖️ Cancel",callback_data:"draft:cancel:"+deliveryDraft.id} ]]});
    }
    if (serviceDraft && serviceDraft.id === activeComposer?.draftId) {
      const contextBefore = await loadServiceDeliveryDraftContext(e, serviceDraft.id);
      if (!contextBefore?.order || contextBefore.order.status !== "payment_verified") {
        return say(e, chat, "The service order is no longer awaiting fulfilment, so the media was not attached. Nothing was sent.", serviceDeliveryKeyboard(serviceDraft.id));
      }
      const extracted = extractSupportMedia(m);
      if (!extracted.media) return say(e, chat, extracted.unsupported || "Attach one photo, video, or PDF/image document under 20 MB. The service draft was not changed.");
      let nextText = serviceDraft.message_text || "";
      let note = "";
      if (caption && !caption.startsWith("/")) {
        if (caption.length > SERVICE_DELIVERY_TEXT_LIMIT) return say(e, chat, "The media caption is too long to use as service fulfilment text, so the media was not attached. Shorten it to " + SERVICE_DELIVERY_TEXT_LIMIT + " characters or fewer.");
        if (!serviceDeliveryBody(serviceDraft)) nextText = caption;
        else if (caption !== serviceDeliveryBody(serviceDraft)) note = "Existing service fulfilment text was kept; the media caption was not used as message text.";
      } else if (caption.startsWith("/")) {
        note = "The media caption was not used as message text.";
      }
      const updated = await e.DB.prepare("UPDATE service_delivery_drafts SET message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?")
        .bind(nextText, extracted.media.kind, extracted.media.fileId, extracted.media.mimeType, serviceDraft.id, user)
        .run();
      if (!updated.meta?.changes) return say(e, chat, "The service fulfilment draft changed while media was being attached. Nothing was sent.");
      const context = await loadServiceDeliveryDraftContext(e, serviceDraft.id);
      if (!context?.order) return say(e, chat, "The service fulfilment draft could not be reloaded. Nothing was sent.");
      return sendServiceDeliveryDraftSummary(e, chat, context.draft, context.order, { heading: "📎 <b>Service fulfilment draft updated</b>", note: note || undefined });
    }
    if (supportDraft && supportDraft.id === activeComposer?.draftId) {
      if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to attach media to a customer support draft. Nothing was sent.");
      const contextBefore = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!contextBefore?.order || String(contextBefore.order.telegram_user_id) !== String(supportDraft.telegram_user_id) || String(contextBefore.order.telegram_chat_id) !== String(supportDraft.telegram_chat_id)) {
        return say(e, chat, "The support draft no longer matches the selected order's Telegram destination, so the media was not attached.", adminMessageKeyboard(supportDraft.id, adminMessagePurpose(supportDraft)));
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
      return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: adminMessagePurpose(context.draft) === "rejection" ? "📎 <b>Rejection follow-up draft updated</b>" : "📎 <b>Customer support draft updated</b>", note: note || undefined });
    }
  }
  if (hasReceiptCandidateMedia && !isBroadcastCaption) {
    const receiptPrompt = await e.DB.prepare("SELECT order_id,order_kind FROM receipt_review_prompts WHERE telegram_user_id=?").bind(user).first<any>();
    let order = receiptPrompt ? await loadCustomerOrderById(e, String(receiptPrompt.order_id)) : null;
    if (receiptPrompt && (!order || String(order.telegram_user_id) !== user)) {
      await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE telegram_user_id=?").bind(user).run();
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "receiptPromptStale"));
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
  if (hasReceiptCandidateMedia && isBroadcastCaption) t = caption;
  let voiceReply = false;
  if (m.voice || m.audio) {
    try {
      t = await transcribeVoice(e, m);
      voiceReply = true;
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      await sayBestEffort(e, chat, tr(language, "heardPrefix") + esc(t));
    } catch (error) {
      console.error("Voice transcription failed", String(error));
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "voiceUnderstandFailed"));
    }
  }
  if (Array.isArray(m.photo) && m.photo.length > 0 && !t) {
    try {
      const answer = await analysePhoto(e, m, caption);
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      await say(e, chat, "🖼️ " + esc(answer), user !== e.ADMIN_TELEGRAM_ID ? customerNavKeyboard(e, language) : undefined);
      if (user !== e.ADMIN_TELEGRAM_ID && voiceReply) {
        const sent = await sendVoiceReply(e, chat, answer, language);
        if (!sent) await sayBestEffort(e, chat, tr(language, "audioReplyFailed"));
      } else if (voiceReply) {
        const sent = await sendVoiceReply(e, chat, answer, "en");
        if (!sent) await sayBestEffort(e, chat, tr("en", "audioReplyFailed"));
      }
      return;
    } catch (error) {
      console.error("Image analysis failed", String(error));
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "imageAnalyseFailed"));
    }
  }
  if (!t) return;
  if (voiceReply && user === e.ADMIN_TELEGRAM_ID && isVoiceConsequentialAdminText(t)) {
    return say(e, chat, "I will not run that consequential admin action from a voice transcript. Tap the confirmation button if one is shown, or type the exact command or YES to confirm deliberately.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && !t.startsWith("/")) {
    const receiptVerifyPrompt = await activeReceiptVerifyPrompt(e, user);
    if (receiptVerifyPrompt) {
      const pendingAction = await e.DB.prepare("SELECT id FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
      const editableComposers = await listEditableAdminComposers(e, user);
      // A durable confirmation or an open composer keeps its existing meaning.
      // If another workflow has taken over since the prompt opened, cancel the
      // short-lived receipt prompt instead of letting it capture later text.
      if (pendingAction || editableComposers.length > 0) {
        await deleteReceiptVerifyPrompt(e, user, { kind: receiptVerifyPrompt.order_kind, id: receiptVerifyPrompt.order_id });
      } else {
        // Keep the escape hatch on the newest message: the original prompt
        // panel is easy to lose once the admin chat scrolls.
        const cancelVerificationKeyboard = { inline_keyboard: [[{ text: "✖️ Cancel verification", callback_data: receiptReviewCallback("cancel", { kind: receiptVerifyPrompt.order_kind, id: receiptVerifyPrompt.order_id }) }]] };
        if (voiceReply) {
          return say(e, chat, "I will not accept a Selar payment reference from a voice transcript. Type or paste the exact reference, or tap <b>Cancel verification</b> below.", cancelVerificationKeyboard);
        }
        if (/^cancel(?:\s+verification)?[.! ]*$/i.test(t)) {
          await deleteReceiptVerifyPrompt(e, user, { kind: receiptVerifyPrompt.order_kind, id: receiptVerifyPrompt.order_id });
          return say(e, chat, "Receipt verification cancelled. The order remains unchanged and unpaid unless it was verified separately.");
        }
        const reference = t.trim();
        if (!reference || reference.length > 200 || /[\s<>]/.test(reference)) {
          return say(e, chat, "Send the <b>exact Selar reference only</b> — one reference with no spaces. The receipt-verification prompt is still open; tap <b>Cancel verification</b> below to stop without changing the order.", cancelVerificationKeyboard);
        }
        const claimedPrompt = await e.DB.prepare("DELETE FROM admin_receipt_verify_prompts WHERE admin_telegram_id=? AND order_id=? AND order_kind=? AND datetime(expires_at) > datetime('now')")
          .bind(user, receiptVerifyPrompt.order_id, receiptVerifyPrompt.order_kind)
          .run();
        if (!claimedPrompt.meta?.changes) return say(e, chat, "That receipt-verification prompt expired or changed. Nothing was verified; tap Verify on the receipt again if you still need it.");
        return manuallyVerifyOrderByReference(e, user, chat, receiptVerifyPrompt.order_kind === "service", receiptVerifyPrompt.order_id, reference);
      }
    }
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && /^(?:yes|yes please|confirm|confirm it|go ahead|do it)[.! ]*$/i.test(t)) {
    const pending = await e.DB.prepare("SELECT id,admin_telegram_id,action,payload,status,expires_at FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (pending) { await confirmPendingAdminAction(e, user, chat, String(pending.id)); return; }
    const composers = await listEditableAdminComposers(e, user);
    if (composers.length > 1) {
      await replyAdminComposerConflict(e, chat, composers, "using YES");
      return;
    }
    const composer = composers[0];
    if (!composer) {
      return say(e, chat, "There is no pending confirmation or editable draft for YES to confirm. Nothing was changed or sent. Use /drafts to inspect draft state.");
    }
    if (composer.kind === "broadcast") {
      const broadcastDraft = await activeBroadcastDraft(e, user);
      if (broadcastDraft?.status === "draft" && broadcastDraft.id === composer.draftId) await executeBroadcast(e, user, chat, broadcastDraft);
      else await say(e, chat, "The broadcast draft changed before YES could be applied. Nothing was sent.");
      return;
    }
    if (composer.kind === "support") {
      if (composer.purpose === "rejection") {
        return say(e, chat, "YES did not reject this order or send the follow-up. Preview the rejection draft, then tap its explicit <b>Reject &amp; send follow-up</b> button — or <b>Reject now (no follow-up)</b> to reject immediately.", adminMessageKeyboard(composer.draftId, "rejection", composer.orderId && composer.orderKind ? { kind: composer.orderKind, id: composer.orderId } : null));
      }
      await executeSupportDraft(e, user, chat, composer.draftId);
      return;
    }
    return say(e, chat, "YES was <b>not</b> added as delivery text and did not send the open <b>" + esc(adminComposerDisplayLabel(composer)) + "</b> draft for <code>" + esc(String(composer.checkoutCode || composer.orderId || composer.draftId)) + "</code>. Fulfilment sends require Preview and the draft's explicit <b>Send</b> button.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && !t.startsWith("/") && chat === user) {
    const editableComposers = await listEditableAdminComposers(e, user);
    if (editableComposers.length > 1) return replyAdminComposerConflict(e, chat, editableComposers, "editing a draft with ordinary text");
    const broadcastDraft = editableComposers[0]?.kind === "broadcast" ? await activeBroadcastDraft(e, user) : null;
    if (broadcastDraft && broadcastDraft.status === "draft" && broadcastDraft.id === editableComposers[0]?.draftId) {
      if (t.length > 900) return say(e, chat, "Broadcast text must be 900 characters or fewer. The draft was not changed.");
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t, broadcastDraft.id, user).run();
      return say(e, chat, "📝 Broadcast text updated. Nothing has been sent.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + broadcastDraft.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + broadcastDraft.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + broadcastDraft.id }]] });
    }
  }
  // Ordinary admin text can edit exactly one open composer across request
  // delivery, service fulfilment, customer support, and broadcast. If legacy
  // rows somehow leave more than one editable draft, fail closed.
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && !t.startsWith("/")) {
    const editableComposers = await listEditableAdminComposers(e, user);
    if (editableComposers.length > 1) return replyAdminComposerConflict(e, chat, editableComposers, "editing a draft with ordinary text");
    const activeComposer = editableComposers[0] || null;
    const deliveryDraft = activeComposer?.kind === "request_delivery" ? await activeDeliveryDraft(e, user) : null;
    const serviceDraft = activeComposer?.kind === "service_delivery" ? await activeServiceDeliveryDraft(e, user) : null;
    const supportDraft = activeComposer?.kind === "support" ? await activeAdminMessageDraft(e, user) : null;
    if (deliveryDraft && deliveryDraft.id === activeComposer?.draftId) {
      if (t.length > 700) return say(e,chat,"Please keep delivery text under 700 characters.");
      await e.DB.prepare("UPDATE delivery_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t,deliveryDraft.id,user).run();
      return say(e,chat,"📝 Draft updated for <code>"+esc(deliveryDraft.checkout_code || "request")+"</code>. Optionally attach one photo, video, or PDF/image document, then preview before sending.",{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+deliveryDraft.id} ],[ {text:"✅ Send to customer",callback_data:"draft:send:"+deliveryDraft.id},{text:"✖️ Cancel",callback_data:"draft:cancel:"+deliveryDraft.id} ]]});
    }
    if (serviceDraft && serviceDraft.id === activeComposer?.draftId) {
      if (t.length > SERVICE_DELIVERY_TEXT_LIMIT) return say(e, chat, "Service fulfilment text is too long. Keep it to " + SERVICE_DELIVERY_TEXT_LIMIT + " characters or fewer. The draft was not changed.");
      const contextBefore = await loadServiceDeliveryDraftContext(e, serviceDraft.id);
      if (!contextBefore?.order || contextBefore.order.status !== "payment_verified") {
        return say(e, chat, "The service order is no longer awaiting fulfilment, so the text was not added. Nothing was sent.", serviceDeliveryKeyboard(serviceDraft.id));
      }
      const updated = await e.DB.prepare("UPDATE service_delivery_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t, serviceDraft.id, user).run();
      if (!updated.meta?.changes) return say(e, chat, "The service fulfilment draft changed while it was being updated. Nothing was sent.");
      const context = await loadServiceDeliveryDraftContext(e, serviceDraft.id);
      if (!context?.order) return say(e, chat, "The service fulfilment draft could not be reloaded. Nothing was sent.");
      return sendServiceDeliveryDraftSummary(e, chat, context.draft, context.order, { heading: "📝 <b>Service fulfilment draft updated</b>" });
    }
    if (supportDraft && supportDraft.id === activeComposer?.draftId && chat === user) {
      if (t.length > ADMIN_MESSAGE_TEXT_LIMIT) return say(e, chat, "Support message text is too long. Keep it to " + ADMIN_MESSAGE_TEXT_LIMIT + " characters or fewer. The draft was not changed.");
      const contextBefore = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!contextBefore?.order || String(contextBefore.order.telegram_user_id) !== String(supportDraft.telegram_user_id) || String(contextBefore.order.telegram_chat_id) !== String(supportDraft.telegram_chat_id)) {
        return say(e, chat, "The support draft no longer matches the selected order's Telegram destination, so the text was not added.", adminMessageKeyboard(supportDraft.id, adminMessagePurpose(supportDraft)));
      }
      const updated = await e.DB.prepare("UPDATE admin_message_drafts SET message_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(t, supportDraft.id, user).run();
      if (!updated.meta?.changes) return say(e, chat, "The support draft changed while it was being updated. Nothing was sent.");
      const context = await loadAdminMessageDraftContext(e, supportDraft.id);
      if (!context?.order) return say(e, chat, "The support draft could not be reloaded. Nothing was sent.");
      return sendAdminMessageDraftSummary(e, chat, context.draft, context.order, { heading: adminMessagePurpose(context.draft) === "rejection" ? "📝 <b>Rejection follow-up draft updated</b>" : "📝 <b>Customer support draft updated</b>" });
    }
  }
  // Telegram may append @BotName to slash commands. Normalize only the command token.
  t = t.replace(/^([\/][A-Za-z0-9_]+)@[A-Za-z0-9_]+(?=\s|$)/, "$1");
  if (user === e.ADMIN_TELEGRAM_ID && chat !== user) {
    const adminOnlyText = /^\/(?:admin|menu|help|pending|orders|order|profiles|profile|drafts|recoverdraft|broadcast|broadcastcancel|deleteprofile|hideprofile|restoreprofile|expirepending|deleteorder|clearorders|reject|message|deliver|setcontact|enablecontact|disablecontact|authorizecontact|verify|verifyservice)(?:\s|$)/i.test(t)
      || /^(?:list|show|view)\s+(?:all\s+)?(?:profiles|(?:recent\s+)?orders|pending\b.*)$/i.test(t)
      || /^(?:delete|hide|remove|restore)\s+profile\b/i.test(t)
      || /^(?:reject|decline|approve|deliver|fulfil|fulfill)\b.*\bFL-[A-Z0-9]{6}\b/i.test(t)
      || /^prepare\s+delivery\s+for\b.*\bFL-[A-Z0-9]{6}\b/i.test(t)
      || /^(?:send\s+)?broadcast\b/i.test(t)
      || /^send\s+(?:mass\s+)?messages?\s+to\s+clients\b/i.test(t)
      || /^send\s+(?:photo|video|media)\s+to\s+clients\b/i.test(t)
      || /^(?:send\s+)?(?:a\s+)?message\s+to\s+(?:all\s+clients|customer\b.*\bFL-[A-Z0-9]{6}\b)/i.test(t)
      || /^message\s+customer\b.*\bFL-[A-Z0-9]{6}\b/i.test(t)
      || /^(?:delete|remove|clear)\b.*\b(?:FL-[A-Z0-9]{6}|[0-9a-f-]{36})\b/i.test(t)
      || /^(?:delete|remove|clear|close|cancel)\s+all\s+(?:pending|unpaid|finished|closed|completed\s+)?orders[.! ]*$/i.test(t)
      || /^(?:write|craft|draft|compose)\b.*\b(?:message|broadcast)\b/i.test(t);
    if (adminOnlyText) return say(e, chat, "Open the private Admin Desk chat to use admin tools. Nothing was changed or sent.");
  }
  if (user === e.ADMIN_TELEGRAM_ID) {
    if (/^(?:list|show|view)\s+(?:all\s+)?profiles$/i.test(t)) t = "/profiles";
    else if (/^(?:list|show|view)\s+(?:recent\s+)?orders$/i.test(t)) t = "/orders";
    else if (/^(?:show|list|view)\s+drafts$/i.test(t)) t = "/drafts";
    else if (/^(?:inspect|show|view)\s+order\s+([^\s]+)$/i.test(t)) t = "/order " + t.match(/^(?:inspect|show|view)\s+order\s+([^\s]+)$/i)[1];
    else if (/^(?:inspect|show|view)\s+profile\s+([^\s]+)$/i.test(t)) t = "/profile " + t.match(/^(?:inspect|show|view)\s+profile\s+([^\s]+)$/i)[1];
    else if (/^(?:delete|hide|remove)\s+profile\b/i.test(t)) {
      return say(e, chat, "Profile deletion/hiding is not an AI or natural-language action, so nothing was changed. To reversibly hide a profile yourself, use <code>/hideprofile PROFILE_ID</code> and confirm. Permanent removal requires a website source change and redeployment.");
    }
    else if (/^restore\s+profile\s+([A-Za-z0-9._-]{1,50})$/i.test(t)) t = "/restoreprofile " + t.match(/^restore\s+profile\s+([A-Za-z0-9._-]{1,50})$/i)[1];
    else if (/^(?:reject|decline)\s+(?:order\s+)?FL-[A-Z0-9]{6}$/i.test(t)) t = "/reject " + t.match(/FL-[A-Z0-9]{6}/i)[0];
    else if (/^(?:approve|deliver|fulfil|fulfill)\s+(?:order\s+)?FL-[A-Z0-9]{6}$/i.test(t)) t = "deliver " + t.match(/FL-[A-Z0-9]{6}/i)[0];
    else if (/^(?:send\s+)?broadcast(?:\s+to\s+(?:all\s+)?clients)?$/i.test(t) || /^send\s+(?:mass\s+)?messages?\s+to\s+clients$/i.test(t) || /^send\s+(?:photo|video|media)\s+to\s+clients$/i.test(t) || /^send\s+(?:a\s+)?message\s+to\s+all\s+clients$/i.test(t)) t = "/broadcast";
    else if (/^send\s+(?:a\s+)?(?:mass\s+)?messages?\s+to\s+(?:all\s+)?clients\s*[:\-]\s*[\s\S]+$/i.test(t)) t = "/broadcast " + t.replace(/^send\s+(?:a\s+)?(?:mass\s+)?messages?\s+to\s+(?:all\s+)?clients\s*[:\-]\s*/i, "");
    else if (/^(?:send\s+)?broadcast\s*[:\-]?\s+[\s\S]+$/i.test(t)) t = "/broadcast " + t.replace(/^(?:send\s+)?broadcast\s*[:\-]?\s+/i, "");
    else if (/^(?:send\s+)?(?:a\s+)?message\s+to\s+customer\s+FL-[A-Z0-9]{6}\s*[:\-]\s*[\s\S]+$/i.test(t)) t = "/message " + t.replace(/^(?:send\s+)?(?:a\s+)?message\s+to\s+customer\s+(FL-[A-Z0-9]{6})\s*[:\-]\s*/i, "$1 ");
    else if (/^message\s+customer\s+FL-[A-Z0-9]{6}\s*[:\-]\s*[\s\S]+$/i.test(t)) t = "/message " + t.replace(/^message\s+customer\s+(FL-[A-Z0-9]{6})\s*[:\-]\s*/i, "$1 ");
    else if (/^(?:permanently\s+)?(?:delete|remove|clear)\s+(?:the\s+)?(?:order\s+|request\s+)?(FL-[A-Z0-9]{6}|[0-9a-f-]{36})(?:\s+permanently)?[.! ]*$/i.test(t)) t = "/deleteorder " + t.match(/(FL-[A-Z0-9]{6}|[0-9a-f-]{36})/i)[1];
    else if (/^(?:permanently\s+)?(?:clear|delete|remove)\s+all\s+(?:pending|unpaid)\s+orders?(?:\s+permanently)?[.! ]*$/i.test(t)) t = "/clearorders pending";
    else if (/^(?:permanently\s+)?(?:clear|delete|remove)\s+all\s+(?:finished|closed|completed)\s+orders?(?:\s+permanently)?[.! ]*$/i.test(t)) t = "/clearorders finished";
    else if (/^(?:permanently\s+)?(?:clear|delete|remove)\s+all\s+orders?(?:\s+permanently)?[.! ]*$/i.test(t)) t = "/clearorders";
    else if (/^(?:close|cancel)\s+all\s+pending\s+orders[.! ]*$/i.test(t)) t = "/expirepending";
  }
  if (t.startsWith("/start")) {
    const arg = t.split(/\s+/, 2)[1] || "";
    const isCustomerPrivateStart = user !== e.ADMIN_TELEGRAM_ID && chat === user;
    if (isCustomerPrivateStart) {
      const savedLanguage = await savedCustomerLanguage(e, user);
      if (!savedLanguage) {
        await savePendingStartPayload(e, user, chat, arg);
        return sendLanguagePicker(e, chat);
      }
    }
    if (arg.startsWith("contact_")) return start(e, m, arg);
    if (arg.startsWith("service_")) return startService(e, m, arg.slice("service_".length));
    if (user === e.ADMIN_TELEGRAM_ID && chat === user) {
      return say(e, chat, "Welcome back. Open /admin for the Admin Desk or /profiles to view and search website profiles.");
    }
    const language = await customerLanguage(e, user, chat);
    const siteUrl = (e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "");
    await say(e, chat, tr(language, "plainWelcome"), {
      inline_keyboard: [
        [{ text: tr(language, "websitePhotoPreviews"), url: siteUrl }],
        [{ text: tr(language, "telegramChannel"), callback_data: "services:join" }]
      ]
    });
    // A message can carry only one markup type, so the persistent Start
    // reply keyboard is set by this short follow-up. Once sent it stays
    // beside the customer's message box for the whole chat.
    return say(e, chat, tr(language, "startTip", { startButton: tr(language, "startButton") }), persistentStartKeyboard(language));
  }
  if (/^\/language(?:@[A-Za-z0-9_]+)?$/i.test(t)) {
    if (user !== e.ADMIN_TELEGRAM_ID && chat === user) return sendLanguagePicker(e, chat);
    if (user !== e.ADMIN_TELEGRAM_ID) return say(e, chat, tr(await customerLanguage(e, user, chat), "languagePrivateOnly"));
  }
  if (t === "/creators" || /^\/profiles(?:\s|$)/i.test(t)) {
    if (user !== e.ADMIN_TELEGRAM_ID) {
      const language = await customerLanguage(e, user, chat);
      const siteUrl = (e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "");
      return say(e, chat, tr(language, "profilesOnWebsite", { siteUrl }));
    }
    if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to view profiles. Nothing was changed or sent.");
    if (t === "/creators") t = "/profiles";
  }

  if (user === e.ADMIN_TELEGRAM_ID && /^\/broadcast(?:\s|$)/i.test(t)) {
    const text = t.replace(/^\/broadcast(?:@[A-Za-z0-9_]+)?\s*/i, "").trim();
    if (text.length > 900) return say(e, chat, "Broadcast text must be 900 characters or fewer.");
    const hasAttachedMedia = Boolean((Array.isArray(m.photo) && m.photo.length > 0) || m.document || m.video || (m as any).animation || (m as any).video_note || (m as any).sticker);
    const extractedBroadcastMedia = hasAttachedMedia ? extractSupportMedia(m) : null;
    if (extractedBroadcastMedia && !extractedBroadcastMedia.media) {
      return say(e, chat, (extractedBroadcastMedia.unsupported || "Attach one photo, video, or PDF/image document under 20 MB.") + " No broadcast draft was created or changed.");
    }
    const attachedMedia = extractedBroadcastMedia?.media;
    const active = await activeBroadcastDraft(e, user);
    if (active?.status === "sending") {
      const counts = await broadcastRecipientCounts(e, active.id);
      if (counts.total) {
        return say(e, chat, "📣 <b>A broadcast is already in progress.</b>\n" + formatBroadcastRecipientCounts(counts) + "\nCompleted clients will not receive duplicates. Continue the next saved batch or stop the remaining clients.", broadcastProgressKeyboard(active.id));
      }
      return say(e, chat, "⚠️ A broadcast is already sending or has an uncertain outcome. Use /drafts to inspect it before any recovery; do not blind-retry.");
    }
    if (active?.status === "draft") {
      if (attachedMedia) {
        const nextText = text || String(active.message_text || "").trim();
        const updated = await e.DB.prepare("UPDATE admin_broadcast_drafts SET message_text=?,media_kind=?,media_file_id=?,media_mime_type=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?")
          .bind(nextText || null, attachedMedia.kind, attachedMedia.fileId, attachedMedia.mimeType, active.id, user)
          .run();
        if (!updated.meta?.changes) return say(e, chat, "Broadcast draft changed; media was not attached.");
        return say(e, chat, "📎 <b>Broadcast media attached</b>\nText: " + (nextText ? esc(nextText) : "none") + "\nMedia: " + esc(String(attachedMedia.mimeType || attachedMedia.kind)) + "\nThe saved text will be sent as the media caption.\n\nNothing has been sent. Preview to see the exact media and caption before confirming.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + active.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + active.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + active.id }]] });
      }
      return say(e, chat, "You already have the one open broadcast composer. Send text to update it, attach one photo/video/document, preview it, or use /broadcastcancel.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + active.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + active.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + active.id }]] });
    }
    const conflicts = await adminComposerConflicts(e, user, { kind: "broadcast" });
    if (conflicts.length) return replyAdminComposerConflict(e, chat, conflicts, "opening a broadcast composer");
    const id = crypto.randomUUID();
    try {
      await e.DB.prepare("INSERT INTO admin_broadcast_drafts(id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at) VALUES(?,?,?,?,?,?,'draft',datetime('now','+30 minutes'))").bind(id, user, text || null, attachedMedia?.kind || null, attachedMedia?.fileId || null, attachedMedia?.mimeType || null).run();
    } catch {
      const raced = await activeBroadcastDraft(e, user);
      if (raced?.status === "draft") return say(e, chat, "A broadcast composer was opened at the same time. Use that one composer; no second draft was created.", { inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + raced.id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + raced.id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + raced.id }]] });
      throw new Error("admin_broadcast_draft_create_failed");
    }
    const racedConflicts = await adminComposerConflicts(e, user, { kind: "broadcast", draftId: id });
    if (racedConflicts.length) {
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(id, user).run();
      return replyAdminComposerConflict(e, chat, racedConflicts, "opening a broadcast composer");
    }
    return say(e, chat, "📣 <b>Broadcast draft created</b>\nAudience: every unique saved client chat from profile requests and service orders, excluding your admin chat. Delivery is batched with a saved per-client ledger so nobody is sent the same broadcast twice.\n\nText: " + (text ? esc(text) : "No message text yet. Send text or attach media.") + "\nMedia: " + (attachedMedia ? esc(String(attachedMedia.mimeType || attachedMedia.kind)) + " attached" : "none") + (attachedMedia && text ? "\nThe text will be sent as the media caption." : "") + "\n\nNothing has been sent. Preview and confirm when ready.", {
      inline_keyboard: [[{ text: "👀 Preview audience and content", callback_data: "broadcast:preview:" + id }], [{ text: "✅ Send broadcast", callback_data: "broadcast:send:" + id }, { text: "✖️ Cancel", callback_data: "broadcast:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/broadcastcancel") {
    const draft = await activeBroadcastDraft(e, user);
    if (!draft) return say(e, chat, "No editable or in-progress broadcast draft to cancel.");
    if (draft.status === "sending") {
      await stopBroadcastRemaining(e, user, chat, draft);
      return;
    }
    if (draft.status !== "draft") return say(e, chat, "No editable broadcast draft to cancel.");
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    return say(e, chat, "✖️ Broadcast draft cancelled. Nothing was sent.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && t === "/drafts") {
    const states = await listAdminDraftStates(e, user, ["draft", "sending"]);
    if (!states.length) {
      return say(e, chat, "📝 <b>Admin drafts</b>\nNo editable or locked sending drafts are currently recorded. Sent, cancelled, and expired drafts remain in order history/audit; use /order ORDER_CODE_OR_UUID to inspect a specific order.");
    }
    const lines = ["📝 <b>Admin drafts (" + states.length + ")</b>"];
    const keyboard: Record<string, unknown>[][] = [];
    for (const state of states) {
      const reference = state.checkoutCode || state.orderId || "broadcast audience";
      lines.push(
        "",
        "• <b>" + esc(adminComposerDisplayLabel(state)) + "</b> — <b>" + esc(state.status) + "</b>",
        "  Reference: <code>" + esc(reference) + "</code>",
        "  Draft ID: <code>" + esc(state.draftId) + "</code>",
        "  Text: " + (state.hasText ? "yes" : "no") + " · Media: " + (state.hasMedia ? esc(String(state.mediaLabel || "attached")) : "none"),
        "  Updated: " + esc(String(state.updatedAt || "unknown")) + " UTC · Expires: " + esc(String(state.expiresAt || "unknown")) + " UTC"
      );
      if (state.status === "draft") {
        lines.push("  This is editable. Ordinary text/media should go only to this composer when it is the sole editable draft.");
        if (keyboard.length < 8) keyboard.push([{ text: "✖️ Cancel " + adminComposerDisplayLabel(state), callback_data: adminComposerCancelCallback(state) }]);
      } else if (state.status === "sending") {
        if (state.kind === "broadcast") {
          const counts = await broadcastRecipientCounts(e, state.draftId);
          if (counts.total) {
            lines.push("  Broadcast delivery: sent " + counts.sent + ", failed " + counts.failed + ", uncertain " + counts.uncertain + ", remaining " + counts.pending + ", in flight " + counts.sending + ", cancelled " + counts.cancelled + ", total " + counts.total + ". Saved batches continue automatically; completed clients will not receive duplicates.");
            if (keyboard.length < 8) keyboard.push([{ text: "▶️ Continue broadcast", callback_data: "broadcast:continue:" + state.draftId }, { text: "⏹️ Stop remaining", callback_data: "broadcast:stop:" + state.draftId }]);
            continue;
          }
        }
        const lockedAt = draftExpiryMs(state.updatedAt);
        if (Number.isFinite(lockedAt) && lockedAt <= Date.now() - 5 * 60 * 1000) {
          lines.push("  Locked send is older than five minutes. First inspect the customer conversation. Only if this exact message definitely was not delivered, use <code>" + esc(adminComposerRecoveryCommand(state)) + "</code>.");
        } else {
          lines.push("  Locked send is recent or its timestamp cannot be verified. Wait at least five minutes and inspect Telegram before recovery is available. Do not retry.");
        }
      }
    }
    lines.push("", "Recovery only cancels a stale lock after a separate confirmation. It never resends and never changes payment/order status.");
    return say(e, chat, lines.join("\n"), keyboard.length ? { inline_keyboard: keyboard } : undefined);
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && /^\/recoverdraft(?:\s|$)/i.test(t)) {
    const match = t.match(/^\/recoverdraft\s+(request_delivery|service_delivery|request|service|support|broadcast)\s+([0-9a-f-]{36})$/i);
    if (!match) return say(e, chat, "Usage: /recoverdraft request|service|support|broadcast DRAFT_UUID\nUse /drafts first. Recovery is available only for a stale locked <b>sending</b> draft after you inspect the customer conversation.");
    const token = match[1].toLowerCase();
    const kind: AdminComposerKind = token === "request" || token === "request_delivery"
      ? "request_delivery"
      : token === "service" || token === "service_delivery"
        ? "service_delivery"
        : token as AdminComposerKind;
    const state = await loadAdminDraftStateById(e, user, kind, match[2]);
    if (!state) return say(e, chat, "No " + esc(adminComposerLabel(kind)) + " draft with that ID was found for this admin. Nothing was changed.");
    if (state.status !== "sending") {
      return say(e, chat, inactiveDraftMessage(state.status, "That " + adminComposerLabel(kind) + " draft") + (state.status === "draft" ? " Cancel it normally if you no longer need it." : ""));
    }
    if (kind === "broadcast") {
      const counts = await broadcastRecipientCounts(e, state.draftId);
      if (counts.total) {
        return say(e, chat, "This broadcast uses a saved per-client delivery ledger, so the single-recipient stale-lock recovery confirmation does not apply. Use /drafts to continue remaining batches or stop the remaining clients. Already completed clients will not be resent.", broadcastProgressKeyboard(state.draftId));
      }
    }
    const lockedAt = draftExpiryMs(state.updatedAt);
    if (!state.updatedAt || !Number.isFinite(lockedAt) || lockedAt > Date.now() - 5 * 60 * 1000) {
      return say(e, chat, "That draft is not old enough for recovery, or its lock timestamp cannot be verified. Inspect the customer conversation and wait until the lock is at least five minutes old. Nothing was changed or resent.");
    }
    const payload: DraftRecoveryPayload = { kind, draftId: state.draftId, updatedAt: state.updatedAt };
    const id = await createPendingAdminAction(e, user, "recover_draft", JSON.stringify(payload));
    if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Confirm or cancel it before preparing draft recovery. Nothing was changed.");
    return say(e, chat, "⚠️ <b>Cancel this stale locked draft?</b>\nType: <b>" + esc(adminComposerLabel(kind)) + "</b>\nReference: <code>" + esc(String(state.checkoutCode || state.orderId || "broadcast audience")) + "</code>\nDraft ID: <code>" + esc(state.draftId) + "</code>\nLocked/updated: " + esc(state.updatedAt) + " UTC\n\nConfirm <b>only if you inspected the recipient conversation and this exact message was definitely not delivered</b>. Confirmation cancels the locked draft so a fresh draft can be created. It does <b>not</b> send or resend anything and does not change payment, fulfilment, or order status.", {
      inline_keyboard: [[{ text: "✅ I inspected — cancel stale lock", callback_data: "admin-action:confirm:" + id }], [{ text: "Cancel recovery", callback_data: "admin-action:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && /^\/order(?:\s|$)/i.test(t)) {
    const match = t.match(/^\/order\s+([^\s]+)$/i);
    if (!match) return say(e, chat, "Usage: /order FL-ABC123 or /order ORDER_UUID\nUse /orders [search text] to find recent orders.");
    const resolved = await resolveCustomerOrderReference(e, match[1]);
    if (resolved.error === "invalid") return say(e, chat, "Use a full order UUID or an FL- order code. No records were changed.");
    if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order. Use /orders to identify the exact UUID, then run /order ORDER_UUID.");
    if (!resolved.order) return say(e, chat, "No request or service order matched that reference.");
    const order = await loadCustomerOrderByKind(e, resolved.order.kind, resolved.order.id) || resolved.order;
    await sendAdminOrderInspection(e, chat, order, true);
    return;
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && /^\/profile(?:\s|$)/i.test(t)) {
    const match = t.match(/^\/profile\s+(.{1,120})$/i);
    if (!match) return say(e, chat, "Usage: /profile PROFILE_ID_OR_NAME\nUse /profiles, /profiles SEARCH, /profiles hidden, or /profiles all [search].");
    const requested = match[1].trim();
    const requestedLower = requested.toLocaleLowerCase("en");
    let catalogueState: { profiles: Profile[]; hiddenRows: HiddenProfileRow[] };
    try {
      catalogueState = await catalogueIncludingHidden(e);
    } catch {
      const hidden = await hiddenProfileRows(e);
      const hiddenRow = hidden.find(row => String(row.profile_id).toLocaleLowerCase("en") === requestedLower || String(row.profile_id).replace(/\./g, "_dot_").toLocaleLowerCase("en") === requestedLower);
      return say(e, chat, hiddenRow
        ? "I couldn't load the live website source catalogue just now, but D1 has a hidden-profile override for <code>" + esc(String(hiddenRow.profile_id)) + "</code> (hidden " + esc(String(hiddenRow.hidden_at || "unknown")) + " UTC). Try /profile again when the catalogue is reachable to see whether the source profile still exists."
        : "I couldn't load the live website source catalogue just now, so I cannot truthfully inspect that profile. Please try /profile again shortly.");
    }
    const decodedId = requested.replace(/_dot_/gi, ".");
    const exact = catalogueState.profiles.filter(profile =>
      profile.id.toLocaleLowerCase("en") === requestedLower ||
      profile.id.toLocaleLowerCase("en") === decodedId.toLocaleLowerCase("en") ||
      profile.id.replace(/\./g, "_dot_").toLocaleLowerCase("en") === requestedLower ||
      profile.name.toLocaleLowerCase("en") === requestedLower
    );
    const matches = exact.length ? exact : catalogueState.profiles.filter(profile =>
      profile.id.toLocaleLowerCase("en").includes(requestedLower) ||
      profile.name.toLocaleLowerCase("en").includes(requestedLower)
    );
    const hiddenById = new Map(catalogueState.hiddenRows.map(row => [String(row.profile_id), row]));
    if (!matches.length) {
      const staleHidden = catalogueState.hiddenRows.find(row => String(row.profile_id).toLocaleLowerCase("en") === requestedLower || String(row.profile_id).toLocaleLowerCase("en") === decodedId.toLocaleLowerCase("en"));
      if (staleHidden) {
        return say(e, chat, "⚠️ <b>Hidden-profile override without a live source profile</b>\nProfile ID: <code>" + esc(String(staleHidden.profile_id)) + "</code>\nHidden at: " + esc(String(staleHidden.hidden_at || "unknown")) + " UTC\n\nThis ID is not in the current published source catalogue, so it cannot appear publicly even if restored. Restoring only removes the D1 override; the website source would also need to contain and deploy the profile. Existing orders/audit records are retained.");
      }
      return say(e, chat, "No current website source profile matched that ID or name. Try /profiles all SEARCH to include hidden profiles.");
    }
    if (matches.length > 1) {
      const lines = matches.slice(0, 20).map((profile, index) => String(index + 1) + ". <b>" + esc(profile.name) + "</b> · <code>" + esc(profile.id) + "</code>" + (hiddenById.has(profile.id) ? " · <b>hidden</b>" : " · visible"));
      return say(e, chat, "<b>Multiple profiles matched (" + matches.length + ")</b>\n" + lines.join("\n") + (matches.length > 20 ? "\n…showing the first 20." : "") + "\n\nRun /profile PROFILE_ID for one exact record.");
    }
    return say(e, chat, await formatAdminProfileInspection(e, matches[0], hiddenById.get(matches[0].id) || null));
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/(?:deleteprofile|hideprofile)\s+/i.test(t)) {
    const match = t.match(/^\/(?:deleteprofile|hideprofile)\s+([A-Za-z0-9._-]{1,50})$/i);
    if (!match) return say(e, chat, "Usage: /hideprofile PROFILE_ID (legacy alias: /deleteprofile PROFILE_ID)");
    const profileId = match[1];
    let sourceProfiles: Profile[] = [];
    let hiddenRows: HiddenProfileRow[] = [];
    try {
      const state = await catalogueIncludingHidden(e);
      sourceProfiles = state.profiles;
      hiddenRows = state.hiddenRows;
    } catch {
      return say(e, chat, "I couldn't load the live website source catalogue, so I did not prepare a visibility change. Try /hideprofile again shortly.");
    }
    const profile = sourceProfiles.find(p => p.id === profileId);
    const hiddenRow = hiddenRows.find(row => String(row.profile_id) === profileId);
    if (profile && hiddenRow) return say(e, chat, "That profile is already hidden by the reversible Admin Desk override. Use /profile " + esc(profileId) + " to inspect it or /restoreprofile " + esc(profileId) + " to make it visible again.");
    if (!profile) return say(e, chat, hiddenRow
      ? "That ID has a hidden-profile override but is not in the current website source catalogue. Use /profile " + esc(profileId) + " to inspect the stale override; no new change was prepared."
      : "That profile ID is not in the current website source catalogue. Check /profiles all or /profile PROFILE_ID. Nothing was changed.");
    const id = await createPendingAdminAction(e, user, "hide_profile", profileId);
    if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another.");
    return say(e, chat, "⚠️ <b>Hide website profile?</b>\n" + esc(profile.name) + " (<code>" + esc(profile.id) + "</code>) will be removed from website listings/search, blocked on its direct profile page after the visibility check, and excluded from the Telegram request catalogue.\n\nThis is a <b>reversible hide</b>, not physical deletion: website source files, build/SEO artifacts already published, orders, and audit history remain. Permanent removal requires a website source change and redeployment.\n\nReply <b>YES</b> or use the button to confirm.", {
      inline_keyboard: [[{ text: "🗑️ Confirm hide profile", callback_data: "admin-action:confirm:" + id }], [{ text: "Cancel", callback_data: "admin-action:cancel:" + id }]]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/expirepending") {
    return prepareClosePendingOrders(e, user, chat);
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/deleteorder(?:\s|$)/i.test(t)) {
    if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to prepare permanent order deletion. Nothing was deleted.");
    const match = t.match(/^\/deleteorder\s+(\S+)$/i);
    if (!match) return say(e, chat, "Usage: /deleteorder FL-ABC123 or /deleteorder ORDER_UUID\nThis only prepares a permanent-deletion preview; nothing is deleted until you explicitly confirm.");
    return prepareOrderDeletionByReference(e, user, chat, match[1]);
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/clearorders(?:\s|$)/i.test(t)) {
    if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to prepare permanent order deletion. Nothing was deleted.");
    const match = t.match(/^\/clearorders(?:\s+(pending|finished|all))?$/i);
    if (!match) return say(e, chat, "Usage: /clearorders, /clearorders pending, /clearorders finished, or /clearorders all\nWithout a scope, the bot shows scope buttons and counts. Nothing is deleted until you confirm the exact snapshot preview.");
    if (!match[1]) return sendClearOrdersScopeChooser(e, user, chat);
    return prepareBulkOrderDeletion(e, user, chat, match[1].toLowerCase() as OrderDeletionScope);
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/restoreprofile\s+/i.test(t)) {
    const match = t.match(/^\/restoreprofile\s+([A-Za-z0-9._-]{1,50})$/i);
    if (!match) return say(e, chat, "Usage: /restoreprofile PROFILE_ID");
    const result = await e.DB.prepare("DELETE FROM hidden_profiles WHERE profile_id=?").bind(match[1]).run();
    if (!result.meta?.changes) return say(e, chat, "That profile does not have a hidden-profile override, or the ID is invalid. Use /profile PROFILE_ID to inspect its source/visibility state.");
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,profile_id,details) VALUES(?,'profile_restored',?,'Admin removed reversible hidden-profile override')").bind(user, match[1]).run();
    let sourceNote = "I couldn't verify the live source catalogue in this step, so use /profile " + esc(match[1]) + " to confirm whether the source profile is present.";
    try {
      const sourceProfiles = await fetchPublicCatalogue(e);
      sourceNote = sourceProfiles.some(profile => profile.id === match[1])
        ? "The profile is present in the live source catalogue; refresh the website to see it again."
        : "The override was removed, but this ID is not in the current website source catalogue, so it will not appear until the website source contains and deploys it.";
    } catch {}
    return say(e, chat, "✅ Reversible hidden-profile override removed for <code>" + esc(match[1]) + "</code>. " + sourceNote);
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/admin" || t === "/menu")) {
    return say(e, chat, "<b>Admin Desk</b>\nChoose what you want to manage. Payment checks remain manual, and request delivery still requires your explicit send confirmation.", {
      inline_keyboard: [
        [{ text: "📥 Review requests", callback_data: "admin:pending" }],
        [{ text: "🧾 Review service orders", callback_data: "admin:orders" }],
        [{ text: "📝 Drafts & recovery", callback_data: "admin:drafts" }],
        [{ text: "📣 Broadcast to all clients", callback_data: "admin:broadcast_help" }],
        [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }],
        [{ text: "🗑️ Clear orders permanently", callback_data: "admin:clear_orders" }],
        [{ text: "🤖 Admin assistant (AI tasks)", callback_data: "admin:assistant_help" }],
        [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]
      ]
    });
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && (/^\/profiles(?:\s+.+)?$/i.test(t) || /^list profiles$/i.test(t))) {
    const queryMatch = t.match(/^\/profiles\s+(.+)$/i);
    const rawQuery = queryMatch ? queryMatch[1].trim() : "";
    const rawQueryLower = rawQuery.toLocaleLowerCase("en");
    const mode: "visible" | "hidden" | "all" = rawQueryLower === "hidden"
      ? "hidden"
      : rawQueryLower === "all" || rawQueryLower.startsWith("all ")
        ? "all"
        : "visible";
    const searchText = mode === "all" ? rawQuery.slice(3).trim() : mode === "hidden" ? "" : rawQuery;
    const query = searchText.toLocaleLowerCase("en");

    let sourceProfiles: Profile[] = [];
    let hiddenRows: HiddenProfileRow[] = [];
    let sourceAvailable = true;
    try {
      const state = await catalogueIncludingHidden(e);
      sourceProfiles = state.profiles;
      hiddenRows = state.hiddenRows;
    } catch {
      sourceAvailable = false;
      hiddenRows = await hiddenProfileRows(e);
      if (mode !== "hidden") return say(e, chat, "I couldn't load the live website profile list just now. Please try /profiles again shortly.");
    }
    const hiddenById = new Map(hiddenRows.map(row => [String(row.profile_id), row]));

    type ProfileListEntry = Profile & { hidden?: boolean; hiddenAt?: string | null; sourceMissing?: boolean };
    let entries: ProfileListEntry[];
    if (mode === "hidden") {
      entries = hiddenRows.map(row => {
        const profile = sourceProfiles.find(p => p.id === String(row.profile_id));
        return {
          id: String(row.profile_id),
          name: profile?.name || "(not in live source catalogue)",
          hidden: true,
          hiddenAt: row.hidden_at || null,
          sourceMissing: !profile
        };
      });
    } else {
      const base = mode === "all" ? sourceProfiles : sourceProfiles.filter(profile => !hiddenById.has(profile.id));
      entries = base.map(profile => ({ ...profile, hidden: hiddenById.has(profile.id), hiddenAt: hiddenById.get(profile.id)?.hidden_at || null }));
    }
    const filtered = query
      ? entries.filter(p => p.id.toLocaleLowerCase("en").includes(query) || p.name.toLocaleLowerCase("en").includes(query))
      : entries;
    if (filtered.length === 0) {
      return say(e, chat, mode === "hidden"
        ? "No profiles currently have a reversible hidden-profile override."
        : "No website profiles matched that search. Try /profiles, /profiles hidden, or /profiles all SEARCH.");
    }
    const heading = mode === "hidden"
      ? "<b>👁️‍🗨️ Hidden website profiles (" + filtered.length + ")</b>" + (sourceAvailable ? "" : "\n<i>Live source catalogue unavailable; names may be missing.</i>")
      : mode === "all"
        ? "<b>📚 Website source profiles including hidden overrides (" + filtered.length + (query ? " matching your search" : "") + ")</b>"
        : "<b>📚 Current website profiles (" + filtered.length + (query ? " matching your search" : "") + ")</b>";
    const chunks: string[] = [];
    let current = heading;
    filtered.forEach((p, i) => {
      const visibility = mode === "visible" ? "" : p.hidden ? " · <b>hidden</b>" : " · visible";
      const sourceNote = p.sourceMissing ? " · source missing" : "";
      const hiddenNote = p.hiddenAt ? " · hidden " + esc(String(p.hiddenAt)) + " UTC" : "";
      const line = String(i + 1) + ". <b>" + esc(p.name) + "</b> · <code>" + esc(p.id) + "</code>" + visibility + sourceNote + hiddenNote;
      if (current.length + line.length + 1 > 3500) {
        chunks.push(current);
        current = line;
      } else {
        current += "\n" + line;
      }
    });
    chunks.push(current);
    for (const chunk of chunks) await say(e, chat, chunk);
    return;
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && (/^\/orders(?:\s+.+)?$/i.test(t) || /^show orders$/i.test(t))) {
    const searchMatch = t.match(/^\/orders\s+(.+)$/i);
    const query = searchMatch ? searchMatch[1].trim().toLocaleLowerCase("en") : "";
    const contacts = await e.DB.prepare("SELECT id,checkout_code,status,profile_id AS target,telegram_username,created_at,'contact' AS kind FROM contact_requests ORDER BY created_at DESC LIMIT 100").all<any>();
    const services = await e.DB.prepare("SELECT id,checkout_code,status,service_id AS target,telegram_username,created_at,'service' AS kind FROM service_orders ORDER BY created_at DESC LIMIT 100").all<any>();
    const loadedRows = [...(contacts.results || []), ...(services.results || [])]
      .sort((a:any,b:any) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const filteredRows = query
      ? loadedRows.filter((row:any) => [row.id, row.checkout_code, row.status, row.target, row.telegram_username, row.kind]
        .map(value => String(value || "").toLocaleLowerCase("en"))
        .join(" ")
        .includes(query))
      : loadedRows;
    const rows = filteredRows.slice(0, 30);
    if (!rows.length) return say(e, chat, query ? "No recent orders matched that search in the latest 100 records per type. Try an FL code or use /order ORDER_UUID for an exact older record." : "No orders found.");
    const heading = "<b>🧾 " + (query ? "Orders matching your search" : "Recent orders") + " (" + rows.length + (filteredRows.length > rows.length ? " of " + filteredRows.length : "") + ")</b>\n<i>Search covers the latest 100 profile requests and 100 service orders. Use /order CODE_OR_UUID for full details, including saved service request text. Closing/rejecting retains the order and audit record; use /deleteorder only when you deliberately want confirmed permanent deletion.</i>";
    const chunks: string[] = [];
    let current = heading;
    for (const row of rows) {
      const code = String(row.checkout_code || row.id);
      const source = String(row.kind) === "contact" ? "FansLeak website · model Subscribe" : String(row.target) === "telegram_channel" ? "Telegram bot · services Subscribe" : "Telegram bot · service chat";
      const line = "• <code>" + esc(code) + "</code> · " + esc(String(row.kind)) + " · " + esc(String(row.target || "unknown")) + " · <b>" + esc(String(row.status)) + "</b>\n  Source: " + esc(source) + " · " + esc(String(row.created_at || "unknown")) + "\n  Inspect: <code>/order " + esc(code) + "</code>";
      if (current.length + line.length + 1 > 3500) {
        chunks.push(current);
        current = line;
      } else {
        current += "\n" + line;
      }
    }
    chunks.push(current);
    for (const chunk of chunks) await say(e, chat, chunk);
    return;
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
      await deleteReceiptVerifyPrompt(e, user, { kind: "contact", id: String(contact.id) });
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'admin_request_rejected',?,?)").bind(user, contact.id, "Admin rejected request " + code).run();
      await sayBestEffort(e, contact.telegram_chat_id, tr(await customerLanguageForChat(e, contact.telegram_chat_id), "requestRejectedCode", { code }));
      return say(e, chat, "🚫 Request " + esc(code) + " rejected and customer notified.");
    }
    const service = await e.DB.prepare("SELECT id,telegram_chat_id,status FROM service_orders WHERE checkout_code=?").bind(code).first<any>();
    if (!service) return say(e, chat, "No request or service order found for " + esc(code) + ".");
    if (["fulfilled","cancelled"].includes(String(service.status))) return say(e, chat, "Service order " + esc(code) + " is already " + esc(String(service.status)) + ". No change made.");
    const changed = await e.DB.prepare("UPDATE service_orders SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','payment_review')").bind(service.id).run();
    if (!changed.meta?.changes) return say(e, chat, "Service order state changed before cancellation. Refresh /orders; no success was reported.");
    await deleteReceiptVerifyPrompt(e, user, { kind: "service", id: String(service.id) });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'admin_service_order_cancelled',?,?)").bind(user, service.id, "Admin cancelled service order " + code).run();
    await sayBestEffort(e, service.telegram_chat_id, tr(await customerLanguageForChat(e, service.telegram_chat_id), "serviceCancelledCode", { code }));
    return say(e, chat, "🚫 Service order " + esc(code) + " cancelled and customer notified.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t === "/message" || t.startsWith("/message "))) {
    const match = t.match(/^\/message\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
    if (!match) return say(e, chat, "Format: /message FL-ABC123 Your message here\nYou may also use /message FL-ABC123 on its own, then send text and/or one photo or document. This opens a draft only; it does not send.");
    return createOrReopenAdminMessageDraft(e, m, match[1], match[2] || "");
  }

  if (user === e.ADMIN_TELEGRAM_ID && /^\/deliver(?:\s|$)/i.test(t)) {
    if (chat !== user) return say(e, chat, "Open the private Admin Desk chat to prepare service fulfilment. Nothing was sent.");
    const match = t.match(/^\/deliver\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
    if (!match) return say(e, chat, "Usage: /deliver FL-ABC123 [optional fulfilment text] or /deliver ORDER_UUID [optional fulfilment text]\nThis opens a 30-minute draft. You can then send/replace text and attach one photo, video, or document before previewing and explicitly sending.");
    const resolved = await resolveCustomerOrderReference(e, match[1]);
    if (resolved.error === "invalid") return say(e, chat, "Use a full service-order UUID or an FL- order code. Nothing was sent.");
    if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order, so no service draft was opened. Inspect the exact record with /order ORDER_UUID.");
    if (!resolved.order) return say(e, chat, "No service order matched that reference. Nothing was sent.");
    const order = await loadCustomerOrderByKind(e, resolved.order.kind, resolved.order.id) || resolved.order;
    return createOrReopenServiceDeliveryDraft(e, user, chat, order, match[2] || "");
  }
  if (user === e.ADMIN_TELEGRAM_ID && /^\/(?:setcontact|enablecontact|disablecontact|authorizecontact)(?:\s|$)/i.test(t)) {
    return say(e, chat, "That old creator-contact command has been retired. FansLeak does not store or share a creator contact here.\n\nAfter you manually verify payment, tap <b>Prepare delivery</b> and send the customer your chosen message, media, or other fulfilment through this bot. Nothing was saved or sent by this command.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/pending") {
    const rows = await e.DB.prepare("SELECT id,profile_id,buyer_email,status,checkout_code,payment_reference FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => [r.id, r.profile_id, r.buyer_email || "-", r.status, "code " + (r.checkout_code || "-"), r.payment_reference ? "sale ref attached" : "no sale ref"].map(x => esc(String(x))).join(" | ")).join("\n") || "No pending requests.");
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/help") {
    return say(e, chat, [
      "<b>Admin commands</b>",
      "/pending — profile requests awaiting payment verification or delivery",
      "/orders [search text] — search recent profile/service orders by code, UUID, target, username, kind, or status",
      "/order ORDER_CODE_OR_UUID — inspect one order, including payment evidence, receipts, drafts, and saved service request text",
      "/profiles [search text] — view/search visible website profiles; /profiles hidden and /profiles all [search] include reversible hidden overrides",
      "/profile PROFILE_ID_OR_NAME — inspect one profile's source presence, visibility, and request counts",
      "/drafts — inspect the one editable admin composer and any locked sending drafts/recovery options",
      "/recoverdraft request|service|support|broadcast DRAFT_UUID — prepare audited cancellation of a stale locked sending draft after inspecting Telegram; never resends",
      "/verify REQUEST_UUID SELAR_REFERENCE — manually verify a profile-request payment after checking it in Selar (only when no webhook sale is attached)",
      "/verifyservice ORDER_UUID SELAR_REFERENCE — manually verify a service payment after checking it in Selar",
      "/deliver ORDER_CODE_OR_UUID [fulfilment text] — open a service fulfilment draft; then add/replace text and/or one photo, video, or document before preview and explicit confirmation",
      "/message ORDER_CODE_OR_UUID [text] — open a customer support draft; add text and/or one photo, video, or document, then preview and explicitly send or cancel",
      "/broadcast [text] — open an all-client broadcast draft for every unique saved profile/service order chat; a media caption is saved as its text, then preview and confirm before batched, ledger-tracked sending",
      "/hideprofile PROFILE_ID — preview reversibly hiding a website profile (legacy alias: /deleteprofile)",
      "/restoreprofile PROFILE_ID — remove a reversible hidden-profile override",
      "/expirepending — preview the exact unpaid orders that would close, then confirm",
      "/deleteorder ORDER_CODE_OR_UUID — preview permanently deleting one order and its prompts/receipts/drafts, then confirm; customers are not notified, while audit and used payment-reference records are retained",
      "/clearorders [pending|finished|all] — choose a bulk permanent-deletion scope, preview exact snapshot counts, then confirm; without a scope it shows scope buttons",
      "Admin assistant — in this private chat, type requests such as 'delete order FL-ABC123', 'clear all pending orders', or 'write a message to customer FL-ABC123 saying…'; it only prepares confirmations/drafts and never verifies payments or deletes/hides profiles",
      "/reject FL-ABC123 — reject/cancel one selected order and notify its customer; on a forwarded receipt, Reject instead opens a follow-up text/media composer and rejects only when you send it",
      "",
      "Clients do not receive a creator list in this bot; profiles stay on the website. There is no stored creator contact to share. After manually verifying payment, use Prepare delivery to send the customer your chosen message, media, or other fulfilment here.",
      "Only one editable admin composer can be open across request delivery, service fulfilment, customer support, and broadcast. Ordinary text/media edits only that composer; YES never becomes delivery text and never sends request/service fulfilment.",
      "Profile hiding is reversible and does not delete website source files. Rejecting/closing retains records; only /deleteorder and /clearorders permanently delete order rows after your explicit confirmation.",
      "Payments are never verified automatically. Request delivery remains a separate, explicit admin action after manual payment verification."
    ].join("\n"));
  }
  if (user === e.ADMIN_TELEGRAM_ID && (t.startsWith("/verify ") || t.startsWith("/verifyservice "))) {
    // Manual verification path for payments the admin has checked directly in Selar
    // (e.g. the sale webhook never arrived). This admin action IS the verification;
    // it never approves a profile request or sends request fulfilment by itself.
    const isService = t.startsWith("/verifyservice ");
    const parts = t.split(/\s+/);
    if (parts.length !== 3) {
      return say(e, chat, isService
        ? "Usage: /verifyservice ORDER_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference."
        : "Usage: /verify REQUEST_UUID SELAR_REFERENCE — first check the payment in Selar, then paste its exact reference.");
    }
    return manuallyVerifyOrderByReference(e, user, chat, isService, parts[1] || "", parts[2] || "");
  }

  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/")) return say(e, chat, "I don't recognise that admin command. Open /admin for the button menu or /help for the available commands.");

  if (isPaidClaimText(t)) {
    const order = await findCustomerOrderForPaidClaim(e, user);
    const claimedCode = codeInName(t);
    if (claimedCode && order?.checkout_code && order.checkout_code !== claimedCode) {
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "paidClaimCodeMismatch"));
    }
    return handlePaidClaim(e, chat, user, order);
  }

  const serviceOrder = await e.DB.prepare("SELECT id,status,request_text,checkout_code FROM service_orders WHERE telegram_user_id=? AND status='awaiting_request' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  if (serviceOrder) {
    const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
    const payTriggerMatch = t.match(/^(?:(.*)[.\n;!?\s]+)?\/?(pay|checkout|ready to pay|pay now)$/i);
    if (payTriggerMatch) {
      const leadingText = (payTriggerMatch[1] || "").trim();
      let combined = String(serviceOrder.request_text || "").trim();
      if (leadingText) {
        combined = (combined + (combined ? "\nCustomer: " : "Customer: ") + leadingText).slice(-8000);
        await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(combined, serviceOrder.id).run();
      }
      if (combined.length < 3) return say(e, chat, tr(language, "serviceNeedFirst"));
      if (!e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || provider(e) !== "selar") return say(e, chat, tr(language, "serviceCheckoutNotConfigured"));
      await e.DB.prepare("UPDATE service_orders SET status='pending_payment',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(serviceOrder.id).run();
      const checkout = new URL(e.SERVICE_CHECKOUT_URL);
      checkout.searchParams.set("add_to_cart", "1");
      const markup = {
        inline_keyboard: [
          [{ text: tr(language, "payNow"), url: checkout.toString() }],
          [{ text: tr(language, "copyUniqueCode"), callback_data: `copycode:${serviceOrder.id}` }],
          [{ text: tr(language, "doneCheckoutCompleted"), callback_data: `done:${serviceOrder.id}` }],
          [{ text: tr(language, "paidCheckAgain"), callback_data: `paid:${serviceOrder.id}` }]
        ]
      };
      return say(e, chat, tr(language, "serviceCheckoutInstructions", { code: esc(serviceOrder.checkout_code), exactCodeInstruction: tr(language, "exactCodeNoTrailingSpace") }), markup);
    }
    if (t.length < 2 || t.length > 2000) return say(e, chat, tr(language, "messageLengthInvalid"));
    const previous = String(serviceOrder.request_text || "");
    const updated = (previous + (previous ? "\nCustomer: " : "Customer: ") + t).slice(-8000);
    await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(updated, serviceOrder.id).run();
    if (!e.AI) return say(e, chat, tr(language, "serviceMoreOrPay"));
    try {
      const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: "You are Annie, the warm, helpful assistant for the services available through this chat. Your job is to understand the customer's request and guide them through service details, checkout, billing, and payment. Do not introduce yourself as an AI or use a business brand name; if a name is needed, say “I'm Annie.” Never mention the payment provider by name; say “Pay now,” “checkout,” or “service checkout.” Keep all payment guidance about services offered through this chat, not payments to Telegram, external accounts, creators, or third-party sellers. In this bot context, words like “pay,” “account,” “Telegram account,” or “checkout” refer to the current in-chat service unless the customer clearly says otherwise. If genuinely unclear, ask one brief question about which available service they mean. Respond directly and naturally to what the customer said; do not invent extra services or claim a payment is verified. When the customer is ready to pay for the service order being discussed, guide them to type PAY to receive the service checkout link. Keep responses concise, warm, and helpful. " + aiLanguageInstruction(language) },
          { role: "user", content: t.slice(0, 1500) }
        ]
      });
      const answer = String(result?.response || "").trim().slice(0, 2500);
      if (answer) {
        const transcript = (updated + "\nAssistant: " + answer).slice(-8000);
        await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(transcript, serviceOrder.id).run();
      }
      const finalAnswer = answer ? answer : tr(language, "serviceMoreOrPay");
      await say(e, chat, esc(finalAnswer));
      if (voiceReply) {
        const sent = await sendVoiceReply(e, chat, finalAnswer, language);
        if (!sent) await sayBestEffort(e, chat, tr(language, "audioReplyFailed"));
      }
      return;
    } catch (err) {
      console.error("AI service conversation failed", String(err));
      return say(e, chat, tr(language, "serviceSavedMoreOrPay"));
    }
  }
  const isConfiguredAdminPrivate = user === e.ADMIN_TELEGRAM_ID && chat === user;
  const adminTaskWithOrderCode = isConfiguredAdminPrivate && /\b(delete|remove|clear|get rid|write|craft|draft|compose|message|broadcast|reject|verify|inspect|find|show|list|deliver|fulfil|fulfill|prepare|order|request|status)\b/i.test(t);
  const prompt = await e.DB.prepare("SELECT order_id,order_kind FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).first<any>();
  if (prompt && !adminTaskWithOrderCode && !emailRe.test(t)) {
    const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
    const code = codeInName(t);
    if (!code) return say(e, chat, tr(language, "checkoutNameCodeMissing"));
    const fullName = t.replace(new RegExp("\\s*" + code + "\\s*$", "i"), "").trim();
    if (fullName.length < 2) return say(e, chat, tr(language, "checkoutNameIncludeFullName", { code }));
    const table = prompt.order_kind === "contact" ? "contact_requests" : "service_orders";
    const targetColumn = prompt.order_kind === "contact" ? "profile_id" : "service_id";
    const rawOrder = await e.DB.prepare(`SELECT id,telegram_user_id,telegram_chat_id,telegram_username,${targetColumn} AS target_id,buyer_email,status,payment_method,payment_reference,checkout_code,checkout_name,created_at FROM ${table} WHERE id=? AND telegram_user_id=?`).bind(prompt.order_id, user).first<any>();
    if (!rawOrder || rawOrder.status !== "pending_payment" || rawOrder.checkout_code !== code) return say(e, chat, tr(language, "checkoutNameCodeMismatch"));
    await e.DB.prepare(`UPDATE ${table} SET checkout_name=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND telegram_user_id=? AND status='pending_payment'`).bind(fullName, rawOrder.id, user).run();
    await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).run();
    const order: CustomerOrder = { kind: prompt.order_kind === "contact" ? "contact" : "service", ...rawOrder, checkout_name: fullName };
    return handlePaidClaim(e, chat, user, order, { nameJustRecorded: true });
  }
  const submittedCode = codeInName(t);
  if (submittedCode && !adminTaskWithOrderCode) {
    const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
    return say(e, chat, tr(language, "submitCheckoutNameFirst"));
  }
  if (emailRe.test(t)) {
    const email = t.toLowerCase();
    const req = await e.DB.prepare("SELECT id,status,profile_id,buyer_email,checkout_code FROM contact_requests WHERE telegram_user_id=? AND status='pending_payment' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (req?.status === "pending_payment" && !req.buyer_email) {
      await e.DB.prepare("UPDATE contact_requests SET buyer_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(email, req.id).run();
      if (e.ADMIN_TELEGRAM_ID) {
        await say(e, e.ADMIN_TELEGRAM_ID, `Customer supplied an email for audit context on profile request <code>${esc(req.id)}</code>\nProfile: ${esc(req.profile_id || "unknown")}\nOrder code: <code>${esc(req.checkout_code || "")}</code>\nEmail: <code>${esc(email)}</code>\nEmail cannot match, attach, verify, or approve this order. Use the FL code or exact saved checkout name, then verify manually.`);
      }
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "emailSaved"));
    }
    const serv = await e.DB.prepare("SELECT id,status,service_id,buyer_email,checkout_code FROM service_orders WHERE telegram_user_id=? AND status='pending_payment' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
    if (serv?.status === "pending_payment" && !serv.buyer_email) {
      await e.DB.prepare("UPDATE service_orders SET buyer_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(email, serv.id).run();
      if (e.ADMIN_TELEGRAM_ID) {
        await say(e, e.ADMIN_TELEGRAM_ID, `Customer supplied an email for audit context on service order <code>${esc(serv.id)}</code>\nService: ${esc(serv.service_id || "unknown")}\nOrder code: <code>${esc(serv.checkout_code || "")}</code>\nEmail: <code>${esc(email)}</code>\nEmail cannot match, attach, verify, or fulfil this order. Use the FL code or exact saved checkout name, then verify manually.`);
      }
      const language = user === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, user, chat);
      return say(e, chat, tr(language, "emailSaved"));
    }
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user) {
    const intent = t.toLowerCase().replace(/[!?.,]/g," ").replace(/\s+/g," ").trim();
    if (/^(show|list|view)? ?(pending )?(contact )?requests?$/.test(intent) || intent.includes("pending contact requests")) {
      const rows=await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE status IN ('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 15").all<any>();
      const lines=(rows.results||[]).map((r:any)=>"• <code>"+esc(r.checkout_code||r.id)+"</code> · "+esc(r.profile_id)+" · "+esc(r.status)+" · "+(r.payment_reference?"sale attached":"no sale attached"));
      return say(e,chat,"<b>📥 Pending requests</b>\n"+(lines.join("\n")||"No pending requests."));
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
      return say(e,chat,"<b>📊 Today’s request summary</b>\nCreated: "+String(row?.total||0)+"\nAwaiting payment/manual verification: "+String(row?.pending||0)+"\nPayment verified, awaiting approval: "+String(row?.verified||0)+"\nApproved: "+String(row?.approved||0));
    }
    const deliveryCode=t.match(/\bFL-[A-Z0-9]{6}\b/i);
    if(deliveryCode && (intent.includes("deliver") || intent.includes("fulfil") || intent.includes("fulfill"))) {
      const resolved=await resolveCustomerOrderReference(e,deliveryCode[0].toUpperCase());
      if(!resolved.order) return say(e,chat,resolved.error==="ambiguous" ? "That FL code matches more than one order. Inspect the exact UUID with /order ORDER_UUID before preparing fulfilment." : "No profile request or service order found for <code>"+esc(deliveryCode[0].toUpperCase())+"</code>.");
      const order=await loadCustomerOrderByKind(e,resolved.order.kind,resolved.order.id) || resolved.order;
      if(order.status!=="payment_verified") return say(e,chat,(order.kind==="contact" ? "Request" : "Service order")+" <code>"+esc(String(order.checkout_code || order.id))+"</code> is currently <b>"+esc(order.status)+"</b>. Fulfilment preparation requires manual payment verification first.");
      return sendPrepareFulfilmentPrompt(e, chat, order);
    }
    const codeMatch=t.match(/\bFL-[A-Z0-9]{6}\b/i);
    const assistantActionIntent=/\b(delete|remove|clear|get rid|write|craft|draft|compose|message|broadcast|reject|verify|confirm payment)\b/.test(intent);
    if (codeMatch && !assistantActionIntent && (intent.includes("find") || intent.includes("inspect") || intent.includes("order") || intent.includes("request") || intent.includes("status"))) {
      const resolved=await resolveCustomerOrderReference(e,codeMatch[0].toUpperCase());
      if (!resolved.order) return say(e,chat,resolved.error==="ambiguous" ? "That FL code matches more than one order. Use /orders to identify the exact UUID, then /order ORDER_UUID." : "No profile request or service order found for <code>"+esc(codeMatch[0].toUpperCase())+"</code>.");
      const order=await loadCustomerOrderByKind(e,resolved.order.kind,resolved.order.id) || resolved.order;
      await sendAdminOrderInspection(e,chat,order,true);
      return;
    }
  }
  if (user === e.ADMIN_TELEGRAM_ID && chat === user && !t.startsWith("/")) {
    const handledByAssistant = await handleAdminAssistant(e, m, t, voiceReply);
    if (handledByAssistant) return;
  }
  return aiReply(e, chat, t, "", voiceReply);
}
function adminInspectionValue(value: unknown, fallback = "not recorded"): string {
  const text = String(value ?? "").trim();
  return text ? esc(text) : esc(fallback);
}

function adminOrderInspectionKeyboard(order: CustomerOrder) {
  const rows: Record<string, unknown>[][] = [];
  if (order.status === "pending_payment" && !order.payment_reference) {
    rows.push([
      { text: "✅ Verify", callback_data: receiptReviewCallback("verify", order) },
      { text: "🚫 Reject & message", callback_data: receiptReviewCallback("reject", order) }
    ]);
    rows.push([{ text: "⛔ Just reject", callback_data: receiptReviewCallback("rejectnow", order) }]);
  }
  if (order.status === "pending_payment" && order.payment_reference) {
    rows.push([{ text: "🚫 Reject & message client", callback_data: receiptReviewCallback("reject", order) }]);
    rows.push([{ text: "⛔ Just reject", callback_data: receiptReviewCallback("rejectnow", order) }]);
  }
  if (order.kind === "contact" && order.status === "pending_payment" && order.payment_reference) {
    rows.push([{ text: "✅ I checked Selar — confirm payment", callback_data: "selarverify:" + order.id }]);
  }
  if (order.kind === "service" && order.status === "pending_payment" && order.payment_reference) {
    rows.push([{ text: "✅ I checked Selar — confirm payment", callback_data: "serviceverify:" + order.id }]);
  }
  if (order.kind === "contact" && order.status === "payment_verified") {
    rows.push([
      { text: "📝 Prepare delivery", callback_data: "approve:" + order.id },
      { text: "❌ Reject request", callback_data: "reject:" + order.id }
    ]);
  }
  if (order.kind === "service" && order.status === "payment_verified") {
    rows.push([{ text: "📝 Prepare service fulfilment", callback_data: "admin:service-deliver:" + order.id }]);
  }
  rows.push(
    [{ text: "💬 Message this customer", callback_data: "admin:message:" + order.kind + ":" + order.id }],
    [{ text: "🗑️ Delete order permanently", callback_data: "admin:deleteorder:" + order.kind + ":" + order.id }],
    [{ text: order.kind === "contact" ? "↩️ Back to requests" : "↩️ Back to service orders", callback_data: order.kind === "contact" ? "admin:pending" : "admin:orders" }],
    [{ text: "🏠 Admin Desk", callback_data: "admin:home" }]
  );
  return { inline_keyboard: rows };
}

async function formatAdminOrderInspection(e: Env, order: CustomerOrder): Promise<string> {
  const saleReference = await attachedSaleReference(e, order);
  const saleRow = await e.DB.prepare("SELECT provider_reference,received_at FROM processed_sales WHERE request_id=? ORDER BY received_at DESC LIMIT 1").bind(order.id).first<any>();
  const receipt = await e.DB.prepare("SELECT status,created_at,updated_at FROM payment_receipt_submissions WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(order.id).first<any>();
  const receiptPrompt = await e.DB.prepare("SELECT order_id FROM receipt_review_prompts WHERE telegram_user_id=? AND order_id=? LIMIT 1").bind(order.telegram_user_id, order.id).first<any>();
  const checkoutPrompt = await e.DB.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id=? AND order_id=? LIMIT 1").bind(order.telegram_user_id, order.id).first<any>();

  const draftLines: string[] = [];
  if (order.kind === "contact") {
    const draft = await e.DB.prepare("SELECT id,status,message_text,media_file_id,media_mime_type,media_kind,expires_at,updated_at FROM delivery_drafts WHERE request_id=? LIMIT 1").bind(order.id).first<any>();
    draftLines.push("Request delivery draft: " + (draft
      ? "<b>" + esc(String(draft.status)) + "</b> · text " + (String(draft.message_text || "").trim() ? "yes" : "no") + " · media " + (draft.media_file_id ? esc(String(draft.media_mime_type || draft.media_kind || "attached")) : "none") + " · updated " + esc(String(draft.updated_at || "unknown"))
      : "none"));
  } else {
    const draft = await e.DB.prepare("SELECT id,status,message_text,media_file_id,media_mime_type,media_kind,expires_at,updated_at FROM service_delivery_drafts WHERE service_order_id=? LIMIT 1").bind(order.id).first<any>();
    draftLines.push("Service fulfilment draft: " + (draft
      ? "<b>" + esc(String(draft.status)) + "</b> · text " + (String(draft.message_text || "").trim() ? "yes" : "no") + " · media " + (draft.media_file_id ? esc(String(draft.media_mime_type || draft.media_kind || "attached")) : "none") + " · updated " + esc(String(draft.updated_at || "unknown"))
      : "none"));
  }
  const supportDraft = await e.DB.prepare("SELECT status,purpose,message_text,media_file_id,media_mime_type,media_kind,expires_at,updated_at FROM admin_message_drafts WHERE order_id=? AND order_kind=? ORDER BY updated_at DESC LIMIT 1").bind(order.id, order.kind).first<any>();
  draftLines.push((supportDraft?.purpose === "rejection" ? "Latest rejection follow-up draft: " : "Latest customer-support draft: ") + (supportDraft
    ? "<b>" + esc(String(supportDraft.status)) + "</b> · text " + (String(supportDraft.message_text || "").trim() ? "yes" : "no") + " · media " + (supportDraft.media_file_id ? esc(String(supportDraft.media_mime_type || supportDraft.media_kind || "attached")) : "none") + " · updated " + esc(String(supportDraft.updated_at || "unknown"))
    : "none"));

  const username = String(order.telegram_username || "").trim().replace(/^@+/, "");
  const lines = [
    order.kind === "contact" ? "🔎 <b>Profile request inspection</b>" : "🔎 <b>Service order inspection</b>",
    "Order code: <code>" + adminInspectionValue(order.checkout_code) + "</code>",
    "Order UUID: <code>" + esc(order.id) + "</code>",
    (order.kind === "contact" ? "Profile" : "Service") + ": <code>" + adminInspectionValue(order.target_id, "unknown") + "</code>",
    "Source: " + (order.kind === "contact" ? "FansLeak website → model Subscribe button" : String(order.target_id) === "telegram_channel" ? "Telegram bot → View our services → Subscribe button" : "Telegram bot service chat"),
    "Status: <b>" + esc(order.status) + "</b>",
    "Telegram user: <code>" + esc(order.telegram_user_id) + "</code>" + (username ? " (@" + esc(username) + ")" : ""),
    "Telegram chat: <code>" + esc(order.telegram_chat_id) + "</code>",
    "Created: " + adminInspectionValue(order.created_at, "unknown") + " UTC",
    "Updated: " + adminInspectionValue(order.updated_at, "unknown") + " UTC",
    "",
    "<b>Payment evidence (manual verification still required)</b>",
    "Payment method: " + adminInspectionValue(order.payment_method),
    "Attached payment reference: " + (saleReference ? "<code>" + esc(saleReference) + "</code>" : "none"),
    "Backend sale record: " + (saleRow ? "attached · received " + esc(String(saleRow.received_at || "unknown")) + " UTC" : saleReference ? "reference attached on order" : "none attached"),
    "Saved checkout name: " + adminInspectionValue(order.checkout_name),
    "Saved buyer email clue: " + adminInspectionValue(order.buyer_email) + " <i>(audit context only; email never matches or verifies payment)</i>",
    "Checkout-name prompt open: " + (checkoutPrompt ? "yes" : "no"),
    "Receipt prompt open: " + (receiptPrompt ? "yes" : "no"),
    "Latest receipt submission: " + (receipt ? "<b>" + esc(String(receipt.status)) + "</b> · updated " + esc(String(receipt.updated_at || receipt.created_at || "unknown")) : "none"),
    "",
    "<b>Drafts</b>",
    ...draftLines,
    "",
    order.kind === "contact"
      ? "Delivery is available only when status is <b>payment_verified</b>, and the customer receives only your composed message/media after preview and explicit send confirmation."
      : "Service fulfilment is available only when status is <b>payment_verified</b>. Saved customer request text is shown separately only after manual payment verification."
  ];
  return lines.join("\n");
}

async function sendAdminServiceRequestText(e: Env, chat: string | number, order: CustomerOrder) {
  if (order.kind !== "service") return;
  if (!["payment_verified", "fulfilled"].includes(order.status)) {
    await say(e, chat, "Saved service request text stays hidden until the configured admin manually verifies payment. This order is currently <b>" + esc(order.status) + "</b>.");
    return;
  }
  const requestText = String(order.request_text || "").trim();
  if (!requestText) {
    await say(e, chat, "No saved service request text is recorded for order <code>" + esc(String(order.checkout_code || order.id)) + "</code>.");
    return;
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < requestText.length; offset += 2400) chunks.push(requestText.slice(offset, offset + 2400));
  for (let index = 0; index < chunks.length; index++) {
    await say(e, chat, "<b>Saved service request</b> · order <code>" + esc(String(order.checkout_code || order.id)) + "</code> · part " + (index + 1) + " of " + chunks.length + "\n\n" + esc(chunks[index]));
  }
}

async function sendAdminOrderInspection(e: Env, chat: string | number, order: CustomerOrder, includeServiceRequestText = true) {
  await say(e, chat, await formatAdminOrderInspection(e, order), adminOrderInspectionKeyboard(order));
  if (includeServiceRequestText && order.kind === "service") await sendAdminServiceRequestText(e, chat, order);
}

function orderDeletionScopeLabel(scope: OrderDeletionScope): string {
  return scope === "pending" ? "Pending/unpaid only" : scope === "finished" ? "Finished/closed only" : "ALL orders (every status)";
}

function orderDeletionScopeDescription(scope: OrderDeletionScope): string {
  if (scope === "pending") return "Unpaid/incomplete orders only. Paid orders awaiting fulfilment (<code>payment_verified</code>) and service orders in <code>payment_review</code> are not included.";
  if (scope === "finished") return "Approved, rejected, or expired profile requests and fulfilled or cancelled service orders only. <code>payment_verified</code> and <code>payment_review</code> are not included.";
  return "Every saved profile request and service order in every status, including paid, payment-review, approved, and fulfilled history.";
}

function orderDeletionStatuses(kind: OrderKind, scope: OrderDeletionScope): readonly string[] | null {
  if (scope === "all") return null;
  if (kind === "contact") return scope === "pending" ? PENDING_CONTACT_STATUSES : FINISHED_CONTACT_STATUSES;
  return scope === "pending" ? PENDING_SERVICE_STATUSES : FINISHED_SERVICE_STATUSES;
}

async function loadOrderDeletionSnapshot(e: Env, scope: OrderDeletionScope): Promise<PendingOrderSnapshot> {
  const load = async (table: "contact_requests" | "service_orders", statuses: readonly string[] | null): Promise<PendingOrderSnapshotItem[]> => {
    if (!statuses) {
      const rows = await e.DB.prepare(`SELECT id,status FROM ${table} ORDER BY id`).all<PendingOrderSnapshotItem>();
      return rows.results || [];
    }
    const placeholders = statuses.map(() => "?").join(",");
    const rows = await e.DB.prepare(`SELECT id,status FROM ${table} WHERE status IN (${placeholders}) ORDER BY id`).bind(...statuses).all<PendingOrderSnapshotItem>();
    return rows.results || [];
  };
  return {
    contacts: await load("contact_requests", orderDeletionStatuses("contact", scope)),
    services: await load("service_orders", orderDeletionStatuses("service", scope))
  };
}

async function orderDeletionScopeCounts(e: Env, scope: OrderDeletionScope): Promise<{ contacts: number; services: number; total: number }> {
  const countFor = async (table: "contact_requests" | "service_orders", statuses: readonly string[] | null): Promise<number> => {
    if (!statuses) {
      const row = await e.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<any>();
      return Number(row?.total || 0);
    }
    const placeholders = statuses.map(() => "?").join(",");
    const row = await e.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE status IN (${placeholders})`).bind(...statuses).first<any>();
    return Number(row?.total || 0);
  };
  const contacts = await countFor("contact_requests", orderDeletionStatuses("contact", scope));
  const services = await countFor("service_orders", orderDeletionStatuses("service", scope));
  return { contacts, services, total: contacts + services };
}

async function orderHasSendingDraft(e: Env, kind: OrderKind, id: string): Promise<boolean> {
  const support = await e.DB.prepare("SELECT id FROM admin_message_drafts WHERE order_kind=? AND order_id=? AND status='sending' LIMIT 1").bind(kind, id).first<any>();
  if (support) return true;
  if (kind === "contact") {
    const draft = await e.DB.prepare("SELECT id FROM delivery_drafts WHERE request_id=? AND status='sending' LIMIT 1").bind(id).first<any>();
    return Boolean(draft);
  }
  const draft = await e.DB.prepare("SELECT id FROM service_delivery_drafts WHERE service_order_id=? AND status='sending' LIMIT 1").bind(id).first<any>();
  return Boolean(draft);
}

async function deleteOrderChildRecords(e: Env, kind: OrderKind, ids: string[]): Promise<void> {
  const commonTables = ["checkout_name_prompts", "receipt_review_prompts", "payment_receipt_submissions", "admin_message_drafts", "admin_receipt_verify_prompts"] as const;
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    for (const table of commonTables) {
      await e.DB.prepare(`DELETE FROM ${table} WHERE order_kind=? AND order_id IN (${placeholders})`).bind(kind, ...chunk).run();
    }
    if (kind === "contact") {
      await e.DB.prepare(`DELETE FROM delivery_drafts WHERE request_id IN (${placeholders})`).bind(...chunk).run();
    } else {
      await e.DB.prepare(`DELETE FROM service_delivery_drafts WHERE service_order_id IN (${placeholders})`).bind(...chunk).run();
    }
  }
}

type PermanentOrderDeletionOutcome = "deleted" | "changed" | "blocked_sending";
async function permanentlyDeleteOrderSnapshotItem(e: Env, kind: OrderKind, item: PendingOrderSnapshotItem): Promise<PermanentOrderDeletionOutcome> {
  const order = await loadCustomerOrderByKind(e, kind, item.id);
  if (!order || order.status !== item.status) return "changed";
  if (await orderHasSendingDraft(e, kind, item.id)) return "blocked_sending";
  const table = kind === "contact" ? "contact_requests" : "service_orders";
  const deleted = await e.DB.prepare(`DELETE FROM ${table} WHERE id=? AND status=?`).bind(item.id, item.status).run();
  if (!deleted.meta?.changes) return "changed";
  await deleteOrderChildRecords(e, kind, [item.id]);
  return "deleted";
}

async function prepareSingleOrderDeletion(e: Env, actor: string, chat: string | number, order: CustomerOrder) {
  const payload: SingleOrderDeletionPayload = { kind: order.kind, id: order.id, status: order.status, checkoutCode: order.checkout_code || null };
  const id = await createPendingAdminAction(e, actor, "delete_order", JSON.stringify(payload));
  if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another. Nothing was deleted.");
  const hasPayment = order.status === "payment_verified" || order.status === "approved" || order.status === "fulfilled" || Boolean(order.payment_reference);
  const lines = [
    "⚠️ <b>Permanently delete this order?</b>",
    "Type: <b>" + (order.kind === "contact" ? "Profile request" : "Service order") + "</b>",
    "Order code: <code>" + esc(String(order.checkout_code || "not recorded")) + "</code>",
    "Order UUID: <code>" + esc(order.id) + "</code>",
    (order.kind === "contact" ? "Profile: <code>" : "Service: <code>") + esc(String(order.target_id || "unknown")) + "</code>",
    "Status when previewed: <b>" + esc(order.status) + "</b>"
  ];
  if (hasPayment) lines.push("⚠️ <b>This order has a payment attached or verified.</b> Deleting it removes the saved order the customer paid for; double-check before confirming.");
  lines.push(
    "",
    "This <b>permanently deletes</b> the order row plus its saved prompts, receipt submissions, verification prompt, and drafts. It cannot be undone, and the customer will <b>not</b> be notified.",
    "Kept on purpose: admin audit history and used payment-reference records, so a used Selar reference can never verify another order.",
    "If this order changes after this preview, or one of its drafts is mid-send, it will be skipped instead of deleted.",
    "",
    "Nothing has been deleted yet. Reply <b>YES</b> or tap confirm."
  );
  return say(e, chat, lines.join("\n"), {
    inline_keyboard: [
      [{ text: "🗑️ Yes, permanently delete", callback_data: "admin-action:confirm:" + id }],
      [
        { text: "Cancel", callback_data: "admin-action:cancel:" + id },
        { text: "🔎 Inspect order", callback_data: (order.kind === "contact" ? "admin:request:" : "admin:service:") + order.id }
      ]
    ]
  });
}

async function prepareOrderDeletionByReference(e: Env, actor: string, chat: string | number, rawRef: string) {
  const resolved = await resolveCustomerOrderReference(e, rawRef);
  if (resolved.error === "invalid") return say(e, chat, "Use a full order UUID or an order code in the format <code>FL-ABC123</code>. Nothing was deleted.");
  if (resolved.error === "ambiguous") return say(e, chat, "That reference matches more than one order, so nothing was prepared for deletion. Inspect the exact full order UUID with /order ORDER_UUID.");
  if (resolved.error === "missing" || !resolved.order) return say(e, chat, "No request or service order matched that UUID or FL- order code. Nothing was deleted.");
  const order = await loadCustomerOrderByKind(e, resolved.order.kind, resolved.order.id) || resolved.order;
  return prepareSingleOrderDeletion(e, actor, chat, order);
}

async function sendClearOrdersScopeChooser(e: Env, actor: string, chat: string | number) {
  const [pending, finished, all] = await Promise.all([
    orderDeletionScopeCounts(e, "pending"),
    orderDeletionScopeCounts(e, "finished"),
    orderDeletionScopeCounts(e, "all")
  ]);
  const lines = [
    "🗑️ <b>Clear orders permanently</b>",
    "Choose exactly which orders to preview for permanent deletion:",
    "",
    "• <b>Pending/unpaid:</b> " + pending.total + " (" + pending.contacts + " profile requests + " + pending.services + " service orders)",
    "• <b>Finished/closed:</b> " + finished.total + " (" + finished.contacts + " profile requests + " + finished.services + " service orders)",
    "• <b>ALL orders:</b> " + all.total + " (" + all.contacts + " profile requests + " + all.services + " service orders) — every status, including paid, payment-review, approved, and fulfilled.",
    "",
    "Saved orders also define the client chats used for broadcasts, so clearing orders reduces or empties the future broadcast audience.",
    "Choosing a scope deletes nothing: you will see the exact snapshot counts and must confirm again."
  ];
  return say(e, chat, lines.join("\n"), {
    inline_keyboard: [
      [{ text: "🧹 Pending/unpaid only (" + pending.total + ")", callback_data: "admin:clearorders:pending" }],
      [{ text: "🧹 Finished/closed only (" + finished.total + ")", callback_data: "admin:clearorders:finished" }],
      [{ text: "☠️ ALL orders (" + all.total + ")", callback_data: "admin:clearorders:all" }],
      [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]
    ]
  });
}

async function prepareBulkOrderDeletion(e: Env, actor: string, chat: string | number, scope: OrderDeletionScope) {
  const snapshot = await loadOrderDeletionSnapshot(e, scope);
  const total = snapshot.contacts.length + snapshot.services.length;
  if (!total) return say(e, chat, "There are no orders in the <b>" + esc(orderDeletionScopeLabel(scope)) + "</b> scope to delete. Nothing was changed.");
  const payload: BulkOrderDeletionPayload = { scope, contacts: snapshot.contacts, services: snapshot.services };
  const id = await createPendingAdminAction(e, actor, "delete_orders_bulk", JSON.stringify(payload));
  if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another. Nothing was deleted.");
  const lines = [
    "⚠️ <b>Permanently delete these orders?</b>",
    "Scope: <b>" + esc(orderDeletionScopeLabel(scope)) + "</b> — " + orderDeletionScopeDescription(scope),
    "Profile requests: <b>" + snapshot.contacts.length + "</b>",
    "Service orders: <b>" + snapshot.services.length + "</b>",
    "Total: <b>" + total + "</b>",
    "",
    "Only the order IDs and statuses captured in this preview can be deleted. Orders created or changed afterwards will be left untouched, and any order with a draft mid-send will be skipped.",
    "The saved prompts, receipt submissions, verification prompts, and drafts for deleted orders are removed too. Customers are <b>not</b> notified. Admin audit history and used payment-reference records are kept so a used Selar reference can never verify another order."
  ];
  if (scope === "all") lines.push("☠️ Because this is <b>ALL orders</b>, it also empties the saved order-derived broadcast audience.");
  lines.push("", "Nothing has been deleted yet. Reply <b>YES</b> or tap confirm.");
  return say(e, chat, lines.join("\n"), {
    inline_keyboard: [[
      { text: "🗑️ Yes, permanently delete " + total + (total === 1 ? " order" : " orders"), callback_data: "admin-action:confirm:" + id }
    ], [
      { text: "Cancel", callback_data: "admin-action:cancel:" + id }
    ]]
  });
}

async function prepareClosePendingOrders(e: Env, actor: string, chat: string | number) {
  const contactRows = await e.DB.prepare("SELECT id,status FROM contact_requests WHERE status IN (?,?,?,?) ORDER BY id")
    .bind(...PENDING_CONTACT_STATUSES)
    .all<PendingOrderSnapshotItem>();
  const serviceRows = await e.DB.prepare("SELECT id,status FROM service_orders WHERE status IN (?,?,?) ORDER BY id")
    .bind(...PENDING_SERVICE_STATUSES)
    .all<PendingOrderSnapshotItem>();
  const snapshot: PendingOrderSnapshot = {
    contacts: contactRows.results || [],
    services: serviceRows.results || []
  };
  if (snapshot.contacts.length === 0 && snapshot.services.length === 0) {
    return say(e, chat, "There are no unpaid pending orders to close. Manually verified and payment-review orders are not included in this action.");
  }
  const id = await createPendingAdminAction(e, actor, "close_pending_orders", JSON.stringify(snapshot));
  if (!id) return say(e, chat, "You already have an admin action awaiting confirmation. Reply YES or cancel it before starting another.");
  return say(e, chat, "⚠️ <b>Close these exact pending orders?</b>\nProfile requests to expire: <b>" + snapshot.contacts.length + "</b>\nService orders to cancel: <b>" + snapshot.services.length + "</b>\n\nOnly the order IDs and statuses captured in this preview can close. Orders created or changed after this preview, manually verified orders, and payment-review orders will not be closed. This retains audit records and does not verify or approve payments. Reply <b>YES</b> or use the button to confirm.", {
    inline_keyboard: [[{ text: "✅ Confirm close pending orders", callback_data: "admin-action:confirm:" + id }], [{ text: "Cancel", callback_data: "admin-action:cancel:" + id }]]
  });
}

async function sendPrepareFulfilmentPrompt(e: Env, chat: string | number, order: CustomerOrder) {
  if (order.kind === "contact") {
    return say(e, chat, "📝 <b>Prepare request delivery</b>\nRequest: <code>" + esc(order.id) + "</code>\nCode: <code>" + esc(String(order.checkout_code || "")) + "</code>\nProfile: " + esc(String(order.target_id || "unknown")) + "\n\nTap below to open the delivery draft. No customer message is sent until you preview and explicitly send.", { inline_keyboard: [[{ text: "📝 Prepare delivery", callback_data: "approve:" + order.id }]] });
  }
  return say(e, chat, "📝 <b>Prepare service fulfilment</b>\nOrder: <code>" + esc(order.id) + "</code>\nCode: <code>" + esc(String(order.checkout_code || "")) + "</code>\nService: " + esc(String(order.target_id || "unknown")) + "\n\nTap below to open the service composer. No customer message is sent until you preview and explicitly send.", { inline_keyboard: [[{ text: "📝 Prepare service fulfilment", callback_data: "admin:service-deliver:" + order.id }], [{ text: "🔎 Inspect order and request text", callback_data: "admin:service:" + order.id }]] });
}

async function formatAdminProfileInspection(e: Env, profile: Profile, hiddenRow?: HiddenProfileRow | null): Promise<string> {
  const counts = await e.DB.prepare("SELECT status,COUNT(*) AS count FROM contact_requests WHERE profile_id=? GROUP BY status ORDER BY status").bind(profile.id).all<any>();
  const countLines = (counts.results || []).map(row => "• " + esc(String(row.status)) + ": <b>" + Number(row.count || 0) + "</b>");
  const total = (counts.results || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
  return [
    "🔎 <b>Profile inspection</b>",
    "Name: <b>" + esc(profile.name) + "</b>",
    "Profile ID: <code>" + esc(profile.id) + "</code>",
    "Live source catalogue: <b>present</b>",
    "Current visibility: <b>" + (hiddenRow ? "hidden by Admin Desk override" : "visible") + "</b>",
    ...(hiddenRow ? [
      "Hidden at: " + adminInspectionValue(hiddenRow.hidden_at, "unknown") + " UTC",
      "Hidden reason: " + adminInspectionValue(hiddenRow.reason)
    ] : []),
    "",
    "<b>Profile requests by status</b>",
    ...(countLines.length ? countLines : ["• none"]),
    "Total saved requests: <b>" + total + "</b>",
    "",
    hiddenRow
      ? "Restore with <code>/restoreprofile " + esc(profile.id) + "</code>. Hiding is reversible and does not delete source files, generated SEO pages, orders, or audit history."
      : "Hide reversibly with <code>/hideprofile " + esc(profile.id) + "</code> (legacy alias: /deleteprofile). Permanent removal requires deleting the profile from the website source and redeploying the site; the bot does not physically delete source files.",
    "Existing order and audit records are retained when visibility changes."
  ].join("\n");
}

async function createPendingAdminAction(e: Env, actor: string, action: AdminPendingAction, payload: string | null): Promise<string | null> {
  await e.DB.prepare("UPDATE admin_pending_actions SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE admin_telegram_id=? AND status='pending' AND datetime(expires_at) <= datetime('now')").bind(actor).run();
  const current = await e.DB.prepare("SELECT id FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' AND datetime(expires_at) > datetime('now') LIMIT 1").bind(actor).first<any>();
  if (current) return null;
  const id = crypto.randomUUID();
  try {
    await e.DB.prepare("INSERT INTO admin_pending_actions(id,admin_telegram_id,action,payload,status,expires_at) VALUES(?,?,?,?,'pending',datetime('now','+10 minutes'))").bind(id, actor, action, payload).run();
  } catch {
    return null;
  }
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
      await say(e, chat, "👁️‍🗨️ Profile <code>" + esc(profileId) + "</code> is now reversibly hidden from website listings/search, its direct profile page after the visibility check, and Telegram requests. This is not physical source deletion; website files and already-published build/SEO artifacts remain until a source removal/redeployment. Restore with /restoreprofile " + esc(profileId) + ".");
      return true;
    }
    if (action.action === "close_pending_orders") {
      const snapshot = parsePendingOrderSnapshot(action.payload);
      if (!snapshot) throw new Error("invalid_pending_order_snapshot");
      const closedCustomerChats = new Set<string>();
      let closedContacts = 0;
      for (const item of snapshot.contacts) {
        if (!(PENDING_CONTACT_STATUSES as readonly string[]).includes(item.status)) continue;
        const result = await e.DB.prepare("UPDATE contact_requests SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status=?").bind(item.id, item.status).run();
        if (!result.meta?.changes) continue;
        closedContacts++;
        const row = await e.DB.prepare("SELECT telegram_chat_id FROM contact_requests WHERE id=?").bind(item.id).first<any>();
        if (row?.telegram_chat_id) closedCustomerChats.add(String(row.telegram_chat_id));
      }
      let closedServices = 0;
      for (const item of snapshot.services) {
        if (!(PENDING_SERVICE_STATUSES as readonly string[]).includes(item.status)) continue;
        const result = await e.DB.prepare("UPDATE service_orders SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status=?").bind(item.id, item.status).run();
        if (!result.meta?.changes) continue;
        closedServices++;
        const row = await e.DB.prepare("SELECT telegram_chat_id FROM service_orders WHERE id=?").bind(item.id).first<any>();
        if (row?.telegram_chat_id) closedCustomerChats.add(String(row.telegram_chat_id));
      }
      for (const customerChat of closedCustomerChats) await sayBestEffort(e, customerChat, tr(await customerLanguageForChat(e, customerChat), "pendingOrderClosed"));
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,details) VALUES(?,'admin_closed_pending_orders',?)").bind(actor, "Closed snapshot profile requests=" + closedContacts + " of " + snapshot.contacts.length + ", service orders=" + closedServices + " of " + snapshot.services.length).run();
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      await say(e, chat, "✅ Previewed pending orders closed. Profile requests expired: <b>" + closedContacts + "</b> of " + snapshot.contacts.length + "; service orders cancelled: <b>" + closedServices + "</b> of " + snapshot.services.length + ". Orders that changed after preview were left untouched. Affected customers were notified. Records were retained for audit; no payment was verified.");
      return true;
    }
    if (action.action === "delete_order") {
      const deletion = parseSingleOrderDeletionPayload(action.payload);
      if (!deletion) throw new Error("invalid_single_order_deletion_payload");
      const orderBefore = await loadCustomerOrderByKind(e, deletion.kind, deletion.id);
      const outcome = await permanentlyDeleteOrderSnapshotItem(e, deletion.kind, { id: deletion.id, status: deletion.status });
      const codeLabel = String(orderBefore?.checkout_code || deletion.checkoutCode || deletion.id);
      if (outcome === "deleted") {
        await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'admin_order_permanently_deleted',?,?,?)")
          .bind(
            actor,
            deletion.id,
            deletion.kind === "contact" ? (orderBefore?.target_id || null) : null,
            "Admin permanently deleted " + deletion.kind + " order " + codeLabel + " after snapshot confirmation; previewed_status=" + deletion.status + "; saved prompts/receipt submissions/drafts deleted; admin audit and processed_sales/processed_abandoned_carts retained; customer not notified"
          )
          .run();
      }
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      if (outcome === "deleted") {
        await say(e, chat, "🗑️ <b>Order permanently deleted.</b>\n" + (deletion.kind === "contact" ? "Profile request" : "Service order") + " <code>" + esc(codeLabel) + "</code> and its saved prompts, receipt submissions, and drafts were removed. The customer was not notified. Admin audit history and used payment-reference records were kept.");
      } else if (outcome === "blocked_sending") {
        await say(e, chat, "That order was <b>not deleted</b> because one of its drafts is mid-send (<code>sending</code>). Inspect /drafts and the customer conversation first; do not blind-retry the send. You can prepare deletion again after the send state is resolved.");
      } else {
        await say(e, chat, "That order changed or no longer exists after the deletion preview, so <b>nothing was deleted</b>. Inspect it again before preparing a new deletion.");
      }
      return true;
    }
    if (action.action === "delete_orders_bulk") {
      const deletion = parseBulkOrderDeletionPayload(action.payload);
      if (!deletion) throw new Error("invalid_bulk_order_deletion_payload");
      let deletedContacts = 0;
      let deletedServices = 0;
      let changed = 0;
      let blocked = 0;
      for (const item of deletion.contacts) {
        const outcome = await permanentlyDeleteOrderSnapshotItem(e, "contact", item);
        if (outcome === "deleted") deletedContacts++;
        else if (outcome === "blocked_sending") blocked++;
        else changed++;
      }
      for (const item of deletion.services) {
        const outcome = await permanentlyDeleteOrderSnapshotItem(e, "service", item);
        if (outcome === "deleted") deletedServices++;
        else if (outcome === "blocked_sending") blocked++;
        else changed++;
      }
      const deletedTotal = deletedContacts + deletedServices;
      const previewedTotal = deletion.contacts.length + deletion.services.length;
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,details) VALUES(?,'admin_orders_permanently_deleted_bulk',?)")
        .bind(actor, "Admin permanently deleted snapshot orders; scope=" + deletion.scope + "; profile_requests=" + deletedContacts + " of " + deletion.contacts.length + "; service_orders=" + deletedServices + " of " + deletion.services.length + "; changed_skipped=" + changed + "; sending_skipped=" + blocked + "; saved prompts/receipt submissions/drafts deleted for deleted orders; admin audit and processed_sales/processed_abandoned_carts retained; customers not notified")
        .run();
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      await say(e, chat, "🗑️ <b>Bulk permanent deletion finished.</b>\nScope: <b>" + esc(orderDeletionScopeLabel(deletion.scope)) + "</b>\nPermanently deleted: <b>" + deletedTotal + "</b> of " + previewedTotal + " (" + deletedContacts + " profile requests, " + deletedServices + " service orders).\nSkipped because changed after preview: <b>" + changed + "</b>\nSkipped because a draft was mid-send: <b>" + blocked + "</b>\nCustomers were not notified. Admin audit history and used payment-reference records were kept.");
      return true;
    }
    if (action.action === "recover_draft") {
      const recovery = parseDraftRecoveryPayload(action.payload);
      if (!recovery) throw new Error("invalid_draft_recovery_payload");
      const state = await loadAdminDraftStateById(e, actor, recovery.kind, recovery.draftId);
      if (!state) throw new Error("draft_recovery_target_missing");
      if (state.status !== "sending" || state.updatedAt !== recovery.updatedAt) throw new Error("draft_recovery_state_changed");
      const lockedAt = draftExpiryMs(state.updatedAt);
      if (!Number.isFinite(lockedAt) || lockedAt > Date.now() - 5 * 60 * 1000) throw new Error("draft_recovery_too_recent");
      const table = ADMIN_DRAFT_RECOVERY_TABLES[recovery.kind];
      const recovered = await e.DB.prepare("UPDATE " + table + " SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND admin_telegram_id=? AND status='sending' AND updated_at=?")
        .bind(recovery.draftId, actor, recovery.updatedAt)
        .run();
      if (!recovered.meta?.changes) throw new Error("draft_recovery_state_changed");
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'admin_draft_recovered_cancelled',?,?,?)")
        .bind(
          actor,
          state.orderId || null,
          recovery.kind === "request_delivery" ? (state.targetId || null) : null,
          "Admin confirmed customer-chat inspection and cancelled stale locked " + adminComposerLabel(recovery.kind) + " draft " + recovery.draftId + "; no message was resent; text_present=" + (state.hasText ? "yes" : "no") + "; media_present=" + (state.hasMedia ? "yes" : "no")
        )
        .run();
      await e.DB.prepare("UPDATE admin_pending_actions SET status='completed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='executing'").bind(id).run();
      await say(e, chat, "✅ Stale locked <b>" + esc(adminComposerLabel(recovery.kind)) + "</b> draft cancelled for recovery. <b>Nothing was resent.</b> The related order status was not changed. Create a fresh draft only after checking the customer conversation again.");
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

async function broadcastAudienceCount(e: Env, adminTelegramId: string): Promise<number> {
  const row = await e.DB.prepare("SELECT COUNT(*) AS total FROM (SELECT telegram_chat_id FROM contact_requests UNION SELECT telegram_chat_id FROM service_orders) WHERE telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id)<>'' AND telegram_chat_id<>?")
    .bind(String(adminTelegramId))
    .first<any>();
  return Number(row?.total || 0);
}

async function snapshotBroadcastRecipients(e: Env, draft: AdminBroadcastDraft): Promise<void> {
  await e.DB.prepare("INSERT OR IGNORE INTO admin_broadcast_recipients(broadcast_id,telegram_chat_id) SELECT ?,telegram_chat_id FROM (SELECT telegram_chat_id FROM contact_requests UNION SELECT telegram_chat_id FROM service_orders) WHERE telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id)<>'' AND telegram_chat_id<>? ORDER BY telegram_chat_id")
    .bind(draft.id, String(draft.admin_telegram_id))
    .run();
}

async function broadcastRecipientCounts(e: Env, broadcastId: string): Promise<BroadcastRecipientCounts> {
  const counts: BroadcastRecipientCounts = { total: 0, pending: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, cancelled: 0 };
  const rows = await e.DB.prepare("SELECT status,COUNT(*) AS count FROM admin_broadcast_recipients WHERE broadcast_id=? GROUP BY status").bind(broadcastId).all<any>();
  for (const row of rows.results || []) {
    const status = String(row.status || "") as keyof BroadcastRecipientCounts;
    if (status !== "total" && Object.prototype.hasOwnProperty.call(counts, status)) counts[status] = Number(row.count || 0);
  }
  counts.total = counts.pending + counts.sending + counts.sent + counts.failed + counts.uncertain + counts.cancelled;
  return counts;
}

function formatBroadcastRecipientCounts(counts: BroadcastRecipientCounts): string {
  return "Sent: <b>" + counts.sent + "</b>; failed: <b>" + counts.failed + "</b>; uncertain: <b>" + counts.uncertain + "</b>; cancelled: <b>" + counts.cancelled + "</b>; remaining: <b>" + counts.pending + "</b>; in flight: <b>" + counts.sending + "</b>; total clients: <b>" + counts.total + "</b>.";
}

function broadcastProgressKeyboard(draftId: string) {
  return {
    inline_keyboard: [[
      { text: "▶️ Continue broadcast", callback_data: "broadcast:continue:" + draftId },
      { text: "⏹️ Stop remaining", callback_data: "broadcast:stop:" + draftId }
    ]]
  };
}

async function finalizeBroadcastIfComplete(e: Env, draft: AdminBroadcastDraft, notifyChat?: string | number): Promise<{ counts: BroadcastRecipientCounts; finalized: boolean }> {
  const counts = await broadcastRecipientCounts(e, draft.id);
  if (!counts.total || counts.pending || counts.sending) return { counts, finalized: false };
  const status = counts.cancelled === counts.total
    ? "cancelled"
    : (counts.failed || counts.uncertain || counts.cancelled ? "partial" : "sent");
  const updated = await e.DB.prepare("UPDATE admin_broadcast_drafts SET status=?,media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'")
    .bind(status, draft.id)
    .run();
  if (!updated.meta?.changes) return { counts, finalized: false };
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,details) VALUES(?,?,?)")
    .bind(draft.admin_telegram_id, "admin_broadcast_" + status, "Broadcast draft " + draft.id + ": sent=" + counts.sent + ", failed=" + counts.failed + ", uncertain=" + counts.uncertain + ", cancelled=" + counts.cancelled + ", recipients=" + counts.total)
    .run();
  if (notifyChat !== undefined) {
    await say(e, notifyChat, (status === "sent" ? "✅" : "⚠️") + " <b>Broadcast finished.</b>\n" + formatBroadcastRecipientCounts(counts) + "\nCompleted recipients are recorded in the delivery ledger and will not be sent this broadcast again.");
  }
  return { counts, finalized: true };
}

async function sendBroadcastToRecipient(e: Env, draft: AdminBroadcastDraft, recipient: string): Promise<void> {
  const body = String(draft.message_text || "").trim();
  const caption = body ? { caption: body.slice(0, 900) } : {};
  if (draft.media_file_id && draft.media_kind === "photo") await tg(e, "sendPhoto", { chat_id: recipient, photo: draft.media_file_id, ...caption });
  else if (draft.media_file_id && draft.media_kind === "document" && /^video\//i.test(draft.media_mime_type || "")) await tg(e, "sendVideo", { chat_id: recipient, video: draft.media_file_id, ...caption });
  else if (draft.media_file_id && draft.media_kind === "document") await tg(e, "sendDocument", { chat_id: recipient, document: draft.media_file_id, ...caption });
  else if (draft.media_file_id) throw new Error("broadcast_media_kind_unsupported");
  else await say(e, recipient, esc(body));
}

async function processBroadcastBatch(e: Env, draft: AdminBroadcastDraft, options: { chat?: string | number; notifyProgress?: boolean } = {}): Promise<BroadcastRecipientCounts> {
  if (draft.status !== "sending") return broadcastRecipientCounts(e, draft.id);
  await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='uncertain',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND status='sending' AND attempted_at IS NOT NULL AND datetime(attempted_at)<=datetime('now','-" + BROADCAST_RECIPIENT_STALE_MINUTES + " minutes')")
    .bind(draft.id)
    .run();
  await e.DB.prepare("UPDATE admin_broadcast_drafts SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draft.id).run();
  let counts = await broadcastRecipientCounts(e, draft.id);
  if (!counts.total) return counts;
  const pending = await e.DB.prepare("SELECT telegram_chat_id FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='pending' ORDER BY telegram_chat_id ASC LIMIT ?")
    .bind(draft.id, BROADCAST_BATCH_SIZE)
    .all<any>();
  for (const row of pending.results || []) {
    const recipient = String(row.telegram_chat_id || "");
    if (!recipient) continue;
    const claimed = await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='sending',attempted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND telegram_chat_id=? AND status='pending'")
      .bind(draft.id, recipient)
      .run();
    if (!claimed.meta?.changes) continue;
    try {
      await sendBroadcastToRecipient(e, draft, recipient);
      await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='sent',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND telegram_chat_id=? AND status='sending'")
        .bind(draft.id, recipient)
        .run();
    } catch (err) {
      if (/\b429\b|Too Many Requests/i.test(String(err))) {
        await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='pending',attempted_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND telegram_chat_id=? AND status='sending'")
          .bind(draft.id, recipient)
          .run();
        break;
      }
      await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='failed',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND telegram_chat_id=? AND status='sending'")
        .bind(draft.id, recipient)
        .run();
    }
  }
  const finished = await finalizeBroadcastIfComplete(e, draft, options.chat ?? draft.admin_telegram_id);
  counts = finished.counts;
  if (!finished.finalized && options.notifyProgress && options.chat !== undefined) {
    await say(e, options.chat, "📣 <b>Broadcast in progress.</b>\n" + formatBroadcastRecipientCounts(counts) + "\nDelivery is saved per client, so completed clients will not receive duplicates. Remaining batches continue automatically, or you can continue/stop now.", broadcastProgressKeyboard(draft.id));
  }
  return counts;
}

async function stopBroadcastRemaining(e: Env, actor: string, chat: string | number, draft: AdminBroadcastDraft): Promise<boolean> {
  if (String(draft.admin_telegram_id) !== String(actor)) { await say(e, chat, "Broadcast draft not found for this admin."); return false; }
  if (draft.status !== "sending") { await say(e, chat, inactiveDraftMessage(draft.status, "This broadcast draft")); return false; }
  let counts = await broadcastRecipientCounts(e, draft.id);
  if (!counts.total) {
    await say(e, chat, "This older broadcast has no recipient ledger, so its outcome cannot be resumed or stopped safely recipient-by-recipient. Use /drafts and the existing inspected recovery path; do not blind-retry.");
    return false;
  }
  await e.DB.prepare("UPDATE admin_broadcast_recipients SET status='cancelled',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE broadcast_id=? AND status='pending'").bind(draft.id).run();
  await e.DB.prepare("UPDATE admin_broadcast_drafts SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draft.id).run();
  counts = await broadcastRecipientCounts(e, draft.id);
  if (counts.sending) {
    await say(e, chat, "⏹️ <b>Broadcast stop requested.</b>\n" + formatBroadcastRecipientCounts(counts) + "\nNo further pending clients will be started. An already in-flight Telegram attempt may still complete; it will not be retried.");
    return true;
  }
  const finished = await finalizeBroadcastIfComplete(e, draft, chat);
  return finished.finalized;
}

async function processScheduledBroadcasts(e: Env): Promise<void> {
  const drafts = await e.DB.prepare("SELECT id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at FROM admin_broadcast_drafts WHERE status='sending' ORDER BY updated_at ASC LIMIT 1").all<AdminBroadcastDraft>();
  for (const draft of drafts.results || []) {
    const counts = await broadcastRecipientCounts(e, draft.id);
    if (counts.total) await processBroadcastBatch(e, draft, { chat: draft.admin_telegram_id, notifyProgress: false });
  }
}

async function executeBroadcast(e: Env, actor: string, chat: string | number, draft: AdminBroadcastDraft): Promise<boolean> {
  if (draft.status !== "draft") { await say(e, chat, inactiveDraftMessage(draft.status, "This broadcast draft")); return false; }
  if (Date.parse(draft.expires_at.replace(" ", "T") + (draft.expires_at.endsWith("Z") ? "" : "Z")) < Date.now()) {
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draft.id).run();
    await say(e, chat, "This broadcast draft expired. Nothing was sent."); return false;
  }
  if (!draft.message_text?.trim() && !draft.media_file_id) { await say(e, chat, "Add message text or attach media before confirming the broadcast."); return false; }
  const audienceTotal = await broadcastAudienceCount(e, actor);
  if (!audienceTotal) { await say(e, chat, "There are no saved client chats from profile requests or service orders. Nothing was sent."); return false; }
  const claimed = await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draft.id, actor).run();
  if (!claimed.meta?.changes) {
    const current = await e.DB.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").bind(draft.id).first<any>();
    await say(e, chat, inactiveDraftMessage(current?.status || "changed", "This broadcast draft"));
    return false;
  }
  const sendingDraft = { ...draft, status: "sending" };
  try {
    await snapshotBroadcastRecipients(e, sendingDraft);
  } catch {
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='draft',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending' AND admin_telegram_id=?").bind(draft.id, actor).run();
    await say(e, chat, "The broadcast audience could not be snapshotted safely. Nothing was sent; keep the draft and inspect the deployment/database before retrying.");
    return false;
  }
  const snapshotCounts = await broadcastRecipientCounts(e, draft.id);
  if (!snapshotCounts.total) {
    await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='draft',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending' AND admin_telegram_id=?").bind(draft.id, actor).run();
    await say(e, chat, "There are no saved client chats from profile requests or service orders. Nothing was sent.");
    return false;
  }
  const counts = await processBroadcastBatch(e, sendingDraft, { chat, notifyProgress: true });
  return counts.pending === 0 && counts.sending === 0 && counts.failed === 0 && counts.uncertain === 0 && counts.cancelled === 0;
}

// "Just reject": the admin rejects a still-pending order immediately without
// composing a follow-up. It applies the exact same final state as the
// rejection composer (contact → rejected, service → cancelled), writes its
// own audit action, and tells the client the order was cancelled because
// payment wasn't made. It never sends when a rejection draft is mid-send.
async function executeImmediateReceiptRejection(e: Env, actor: string, chat: string | number, order: CustomerOrder): Promise<void> {
  const inspectKeyboard = { inline_keyboard: [[{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]] };
  const sending = await e.DB.prepare("SELECT id FROM admin_message_drafts WHERE order_id=? AND order_kind=? AND status='sending' LIMIT 1").bind(order.id, order.kind).first<any>();
  if (sending) {
    await say(e, chat, "A message for this order is already sending, so <b>Just reject</b> was not applied. Inspect the order and the customer conversation first.", inspectKeyboard);
    return;
  }
  const orderTable = order.kind === "contact" ? "contact_requests" : "service_orders";
  const nextStatus = order.kind === "contact" ? "rejected" : "cancelled";
  const changed = await e.DB.prepare("UPDATE " + orderTable + " SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND telegram_user_id=? AND telegram_chat_id=?")
    .bind(nextStatus, order.id, order.telegram_user_id, order.telegram_chat_id)
    .run();
  if (!changed.meta?.changes) {
    await say(e, chat, "This order changed before <b>Just reject</b> could apply, so nothing was rejected by this tap. Inspect the order.", inspectKeyboard);
    return;
  }
  await deleteReceiptVerifyPrompt(e, actor, order);
  // Any open rejection composer for this order is now obsolete; cancel it so a
  // stale draft cannot later message the client as if it rejected them.
  await e.DB.prepare("UPDATE admin_message_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE order_id=? AND order_kind=? AND purpose='rejection' AND status='draft'").bind(order.id, order.kind).run();
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)")
    .bind(actor, "admin_receipt_rejected_without_followup", order.id, order.kind === "contact" ? (order.target_id || null) : null, "Admin rejected " + order.kind + " order " + String(order.checkout_code || order.id) + " immediately from receipt review (Just reject); no follow-up was composed")
    .run();
  const code = esc(String(order.checkout_code || order.id));
  const customerLang = await customerLanguage(e, String(order.telegram_user_id), order.telegram_chat_id);
  const clientText = tr(customerLang, order.kind === "contact" ? "justRejectClientContact" : "justRejectClientService", { code });
  let notified = false;
  try { await say(e, order.telegram_chat_id, clientText); notified = true; } catch { notified = false; }
  await say(e, chat, notified
    ? "⛔ " + (order.kind === "contact" ? "Request" : "Order") + " <code>" + code + "</code> rejected now, and the client was told it was cancelled because payment wasn't made."
    : "⛔ " + (order.kind === "contact" ? "Request" : "Order") + " <code>" + code + "</code> rejected now, but the cancellation notice to the client could not be confirmed as delivered. Check the customer conversation.", inspectKeyboard);
}

async function executeSupportDraft(e: Env, actor: string, chat: string | number, draftId: string): Promise<boolean> {
  const context = await loadAdminMessageDraftContext(e, draftId);
  if (!context || String(context.draft.admin_telegram_id) !== actor) { await say(e, chat, "Support draft not found for this admin."); return false; }
  const draft = context.draft, order = context.order;
  const purpose = adminMessagePurpose(draft);
  if (await expireAdminMessageDraftIfNeeded(e, draft)) { await say(e, chat, "Support draft expired. Nothing was sent."); return false; }
  if (draft.status !== "draft") { await say(e, chat, inactiveDraftMessage(draft.status, "This customer-support draft")); return false; }
  if (!order || String(order.telegram_user_id) !== String(draft.telegram_user_id) || String(order.telegram_chat_id) !== String(draft.telegram_chat_id)) { await say(e, chat, "The selected order or customer destination changed. Nothing was sent."); return false; }
  if (purpose === "rejection" && order.status !== "pending_payment") { await say(e, chat, "This order is no longer pending payment, so the rejection follow-up was not sent and its status was not changed by this draft. Inspect the order before taking another action."); return false; }
  const recipientLang = await customerLanguage(e, String(draft.telegram_user_id), draft.telegram_chat_id);
  const problem = adminMessageSendProblem(draft, order, recipientLang);
  if (problem) { await say(e, chat, problem); return false; }
  const orderTable = draft.order_kind === "contact" ? "contact_requests" : "service_orders";
  const rejectionStatusGuard = purpose === "rejection" ? " AND o.status='pending_payment'" : "";
  const claimed = await e.DB.prepare("UPDATE admin_message_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND purpose=? AND message_text IS ? AND media_kind IS ? AND media_file_id IS ? AND media_mime_type IS ? AND EXISTS(SELECT 1 FROM " + orderTable + " o WHERE o.id=admin_message_drafts.order_id AND o.telegram_user_id=admin_message_drafts.telegram_user_id AND o.telegram_chat_id=admin_message_drafts.telegram_chat_id" + rejectionStatusGuard + ")")
    .bind(draftId, actor, purpose, draft.message_text || null, draft.media_kind || null, draft.media_file_id || null, draft.media_mime_type || null).run();
  if (!claimed.meta?.changes) {
    const current = await loadAdminMessageDraft(e, draftId);
    await say(e, chat, current && current.status !== "draft"
      ? inactiveDraftMessage(current.status, "This customer-support draft")
      : purpose === "rejection"
        ? "The rejection draft, destination, or still-pending order status changed before sending. Nothing was sent and the order was not rejected by this tap; preview or inspect it again."
        : "Support draft content or destination changed before sending. Nothing was sent; preview the current draft again.");
    return false;
  }
  if (purpose === "rejection") {
    const nextStatus = draft.order_kind === "contact" ? "rejected" : "cancelled";
    const rejected = await e.DB.prepare("UPDATE " + orderTable + " SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND telegram_user_id=? AND telegram_chat_id=?")
      .bind(nextStatus, draft.order_id, draft.telegram_user_id, draft.telegram_chat_id)
      .run();
    if (!rejected.meta?.changes) {
      await say(e, chat, "⚠️ The order changed after this rejection draft was claimed, so the follow-up was not sent. The draft is locked to prevent a blind retry; inspect the order and customer conversation before recovery.");
      return false;
    }
    await deleteReceiptVerifyPrompt(e, actor, order);
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,?,?,?,?)")
      .bind(actor, "admin_receipt_rejected", draft.order_id, draft.order_kind === "contact" ? (order.target_id || null) : null, "Admin rejected " + draft.order_kind + " order " + String(order.checkout_code || draft.checkout_code || draft.order_id) + " from receipt review; follow-up draft " + draft.id + "; " + adminMessageContentDetails(draft))
      .run();
  }
  const body = adminMessageOutgoingBody(draft, order, recipientLang);
  try {
    if (draft.media_file_id && draft.media_kind === "photo") await tg(e, "sendPhoto", { chat_id: draft.telegram_chat_id, photo: draft.media_file_id, ...(body ? { caption: adminMessageCaption(body, recipientLang), parse_mode: "HTML" } : {}) });
    else if (draft.media_file_id && draft.media_kind === "document" && /^video\//i.test(draft.media_mime_type || "")) await tg(e, "sendVideo", { chat_id: draft.telegram_chat_id, video: draft.media_file_id, ...(body ? { caption: adminMessageCaption(body, recipientLang), parse_mode: "HTML" } : {}) });
    else if (draft.media_file_id && draft.media_kind === "document") await tg(e, "sendDocument", { chat_id: draft.telegram_chat_id, document: draft.media_file_id, ...(body ? { caption: adminMessageCaption(body, recipientLang), parse_mode: "HTML" } : {}) });
    else await say(e, draft.telegram_chat_id, tr(recipientLang, "adminSupportHeader") + "\n\n" + esc(body));
  } catch {
    try { await auditAdminMessageDraft(e, actor, purpose === "rejection" ? "admin_rejection_message_uncertain" : "admin_support_message_uncertain", draft, order, "Telegram " + (purpose === "rejection" ? "rejection follow-up" : "support-message") + " outcome uncertain for " + draft.order_kind + " order " + String(order.checkout_code || draft.checkout_code || draft.order_id) + "; draft locked as sending; " + adminMessageContentDetails(draft)); } catch {}
    try { await notifyAdminIfConfigured(e, "⚠️ " + (purpose === "rejection" ? "Rejection follow-up" : "Customer support message") + " outcome is uncertain for " + draft.order_kind + " order <code>" + esc(String(order.checkout_code || draft.checkout_code || draft.order_id)) + "</code>. The draft remains locked to prevent duplicates. Inspect the customer conversation before any retry."); } catch {}
    await say(e, chat, purpose === "rejection"
      ? "⚠️ The order was rejected, but the follow-up message outcome is uncertain. The draft is locked to prevent duplicate sends; inspect the customer conversation before retrying."
      : "⚠️ Message outcome uncertain. The draft is locked to prevent duplicate sends; inspect the customer conversation before retrying.");
    return false;
  }
  const sent = await e.DB.prepare("UPDATE admin_message_drafts SET status='sent',media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
  await auditAdminMessageDraft(e, actor, purpose === "rejection" ? "admin_rejection_message_customer" : "admin_message_customer", draft, order, "Admin sent " + (purpose === "rejection" ? "receipt-rejection follow-up" : "customer support message") + " for " + draft.order_kind + " order " + String(order.checkout_code || draft.checkout_code || draft.order_id) + "; " + adminMessageContentDetails(draft));
  if (!sent.meta?.changes) await notifyAdminIfConfigured(e, "A customer support message was sent for <code>" + esc(String(order.checkout_code || draft.order_id)) + "</code>, but the draft status changed concurrently. Inspect the audit before any retry.");
  await say(e, chat, purpose === "rejection"
    ? "🚫 Order <code>" + esc(String(order.checkout_code || order.id)) + "</code> rejected and your follow-up was sent to the client."
    : "✅ Support message sent for order <code>" + esc(String(order.checkout_code || order.id)) + "</code>.");
  return true;
}

async function callback(e: Env, u: NonNullable<Update["callback_query"]>) {
  const actor = String(u.from.id), data = u.data || "", chat = u.message?.chat.id;
  const isAdminCallback = /^(?:admin-action:|profiledelete:|receipt:|broadcast:|draft:|service-delivery:|support-message:|admin:|approve:|reject:|selarverify:|serviceverify:)/.test(data);
  if (data.startsWith("language:set:")) {
    const currentLanguage = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message || String(u.message.chat.id) !== actor || actor === e.ADMIN_TELEGRAM_ID) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(currentLanguage, "languagePrivateOnly") });
    }
    const selected = data.slice("language:set:".length);
    if (!isLanguageCode(selected)) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(currentLanguage, "invalidLanguage") });
    }
    const preferenceBefore = await getLanguagePreference(e, actor);
    const pendingPayload = safePendingStartPayload(preferenceBefore?.pending_start_payload);
    const hadSavedLanguage = isLanguageCode(preferenceBefore?.language_code);
    await saveCustomerLanguage(e, actor, String(u.message.chat.id), selected);
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(selected, "languageSavedCallback") });
    const syntheticMessage = { chat: u.message.chat, from: u.from as Msg["from"], text: "/start" + (pendingPayload ? " " + pendingPayload : "") };
    if (pendingPayload.startsWith("contact_")) {
      await say(e, u.message.chat.id, tr(selected, "languageSavedMessage", { language: languageDisplayName(selected) }), persistentStartKeyboard(selected));
      return start(e, syntheticMessage, pendingPayload);
    }
    if (pendingPayload.startsWith("service_")) {
      await say(e, u.message.chat.id, tr(selected, "languageSavedMessage", { language: languageDisplayName(selected) }), persistentStartKeyboard(selected));
      return startService(e, syntheticMessage, pendingPayload.slice("service_".length));
    }
    if (!hadSavedLanguage) return message(e, syntheticMessage);
    return say(e, u.message.chat.id, tr(selected, "languageSavedMessage", { language: languageDisplayName(selected) }) + "\n\n" + tr(selected, "languageUpdatedNoOrderChange"), persistentStartKeyboard(selected));
  }
  if (data === "services:view") {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openBotServices") });
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "servicesReady") });
    return servicesMenu(e, u.message.chat.id);
  }
  if (data === "services:join" || data === "services:continue" || data === "services:restart") {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openBotSubscribe") });
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "gettingReady") });
    return startChannelSubscription(e, { chat: u.message.chat, from: u.from, text: "/start service_telegram_channel" }, data !== "services:join");
  }
  if (data.startsWith("order:cancel:")) {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message || String(u.message.chat.id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openPrivateCancelOrder") });
    const id = data.slice("order:cancel:".length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "invalidOrderReference") });
    await cancelCustomerServiceOrder(e, u.message.chat.id, actor, id);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "orderCancellationChecked") });
  }
  if (data.startsWith("copycode:")) {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message || String(u.message.chat.id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openBotContinue") });
    const id = data.slice("copycode:".length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "invalidOrderReference") });
    const order = await loadCustomerOrderById(e, id);
    if (!order || String(order.telegram_user_id) !== actor || !order.checkout_code) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "orderUnavailableAccount") });
    await say(e, u.message.chat.id, tr(language, "copyUniqueCodeMessage", { code: esc(order.checkout_code), exactCodeInstruction: tr(language, "exactCodeNoTrailingSpace") }));
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "copyUniqueCodeCallback") });
  }
  if (isAdminCallback && (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor)) {
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
  }
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
    let sourceProfiles: Profile[] = [];
    let hiddenRows: HiddenProfileRow[] = [];
    try {
      const state = await catalogueIncludingHidden(e);
      sourceProfiles = state.profiles;
      hiddenRows = state.hiddenRows;
    } catch {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Live profile catalogue unavailable; nothing changed." });
    }
    const profile = sourceProfiles.find(p => p.id === profileId);
    if (!profile) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Profile is not in the current source catalogue." });
    if (hiddenRows.some(row => String(row.profile_id) === profileId)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Profile is already hidden." });
    const pendingId = await createPendingAdminAction(e, actor, "hide_profile", profileId);
    if (!pendingId) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Another admin confirmation is already pending." });
    await say(e, chat, "⚠️ <b>Confirm reversible profile hide</b>\n" + esc(profile.name) + " (<code>" + esc(profile.id) + "</code>) will be hidden from website listings/search, its direct page after the visibility check, and Telegram requests. This does not physically delete website source files or order/audit history.", {
      inline_keyboard: [[{ text: "👁️‍🗨️ Confirm hide profile", callback_data: "admin-action:confirm:" + pendingId }], [{ text: "Cancel", callback_data: "admin-action:cancel:" + pendingId }]]
    });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Review the current confirmation. Nothing changed yet." });
  }
  if (data.startsWith("receipt:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
    const match = data.match(/^receipt:(verify|reject|rejectnow|confirmreject|cancel):([cs]):([0-9a-f-]{36})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid receipt-review action." });
    const action = match[1].toLowerCase();
    const kind: OrderKind = match[2].toLowerCase() === "c" ? "contact" : "service";
    const order = await loadCustomerOrderByKind(e, kind, match[3].toLowerCase());
    if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "That order could not be found." });

    if (action === "cancel") {
      const deleted = await deleteReceiptVerifyPrompt(e, actor, order);
      await say(e, chat, deleted ? "Receipt verification cancelled. The order was not changed." : "Verification closed. The order was not changed.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Verification prompt closed." });
    }

    if (order.status !== "pending_payment") {
      await deleteReceiptVerifyPrompt(e, actor, order);
      await say(e, chat, "This receipt review is closed because the order is now <b>" + esc(order.status) + "</b>. No payment or rejection change was made by this tap.", {
        inline_keyboard: [[{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]]
      });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This order is no longer pending payment." });
    }

    if (action === "rejectnow") {
      // First tap never rejects: it shows exactly what will happen and asks
      // for an explicit confirmation tap.
      const attached = await attachedSaleReference(e, order);
      const code = esc(String(order.checkout_code || order.id));
      await say(e, chat, "⛔ <b>Just reject — no follow-up</b>\n" + (order.kind === "contact" ? "Request" : "Order") + ": <code>" + code + "</code>\n\nThis rejects the " + (order.kind === "contact" ? "request" : "order") + " immediately and tells the client it was cancelled because payment wasn't made. No custom message is composed." + (attached ? "\n\n⚠️ A Selar sale reference (<code>" + esc(attached) + "</code>) is attached to this order. Only continue if you have checked Selar and the payment really was not made." : "") + "\n\nNothing has changed yet.", {
        inline_keyboard: [
          [{ text: "⛔ Yes, reject now", callback_data: receiptReviewCallback("confirmreject", order) }],
          [{ text: "✖️ Cancel — keep order open", callback_data: receiptReviewCallback("cancel", order) }],
          [{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]
        ]
      });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Confirm the immediate rejection. Nothing changed yet." });
    }

    if (action === "confirmreject") {
      await executeImmediateReceiptRejection(e, actor, chat, order);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Immediate rejection processed." });
    }

    if (action === "reject") {
      const existingPrompt = await activeReceiptVerifyPrompt(e, actor);
      if (existingPrompt && (existingPrompt.order_id !== order.id || existingPrompt.order_kind !== order.kind)) {
        await say(e, chat, "A receipt-verification prompt is already open for another order (<code>" + esc(existingPrompt.order_id) + "</code>). Send that exact reference or tap <b>Cancel verification</b> below before opening this rejection composer. Nothing was changed.", {
          inline_keyboard: [[{ text: "✖️ Cancel verification", callback_data: receiptReviewCallback("cancel", { kind: existingPrompt.order_kind, id: existingPrompt.order_id }) }]]
        });
        return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Another verification prompt is open." });
      }
      await deleteReceiptVerifyPrompt(e, actor, order);
      await createOrReopenAdminMessageDraft(e, { chat: { id: Number(chat) }, from: { id: Number(actor) } }, order.id, "", undefined, "rejection");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Rejection follow-up checked. The order is not rejected yet." });
    }

    const attachedReference = await attachedSaleReference(e, order);
    if (attachedReference && String(order.payment_reference || "") === attachedReference) {
      await deleteReceiptVerifyPrompt(e, actor, order);
      await say(e, chat, "🧾 <b>Verify receipt payment</b>\nOrder: <code>" + esc(String(order.checkout_code || order.id)) + "</code>\nAttached Selar reference: <code>" + esc(attachedReference) + "</code>\n\nCheck that exact sale in Selar first. The receipt screenshot and backend record do not verify payment by themselves. Tap the confirmation button only after your manual Selar check.", {
        inline_keyboard: [
          [{ text: "✅ I checked Selar — verify payment", callback_data: (order.kind === "contact" ? "selarverify:" : "serviceverify:") + order.id }],
          [{ text: "🚫 Reject & message client", callback_data: receiptReviewCallback("reject", order) }],
          [{ text: "⛔ Just reject", callback_data: receiptReviewCallback("rejectnow", order) }],
          [{ text: "✖️ Cancel verification", callback_data: receiptReviewCallback("cancel", order) }],
          [{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]
        ]
      });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Check Selar, then confirm verification." });
    }

    const existingPrompt = await activeReceiptVerifyPrompt(e, actor);
    if (existingPrompt && (existingPrompt.order_id !== order.id || existingPrompt.order_kind !== order.kind)) {
      await say(e, chat, "A receipt-verification prompt is already open for another order (<code>" + esc(existingPrompt.order_id) + "</code>). Send that exact reference or tap <b>Cancel verification</b> below before opening another prompt. Nothing was verified.", {
        inline_keyboard: [[{ text: "✖️ Cancel verification", callback_data: receiptReviewCallback("cancel", { kind: existingPrompt.order_kind, id: existingPrompt.order_id }) }]]
      });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Another verification prompt is open." });
    }
    const pendingAction = await e.DB.prepare("SELECT id FROM admin_pending_actions WHERE admin_telegram_id=? AND status='pending' AND datetime(expires_at) > datetime('now') LIMIT 1").bind(actor).first<any>();
    if (pendingAction) {
      await say(e, chat, "Finish or cancel the current Admin Desk confirmation before opening receipt verification. Nothing was verified.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Another admin confirmation is pending." });
    }
    const composers = await listEditableAdminComposers(e, actor);
    if (composers.length) {
      await replyAdminComposerConflict(e, chat, composers, "opening receipt verification");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Finish the open composer first." });
    }
    await e.DB.prepare("INSERT INTO admin_receipt_verify_prompts(admin_telegram_id,order_id,order_kind,expires_at) VALUES(?,?,?,datetime('now','+10 minutes')) ON CONFLICT(admin_telegram_id) DO UPDATE SET order_id=excluded.order_id,order_kind=excluded.order_kind,expires_at=excluded.expires_at,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
      .bind(actor, order.id, order.kind)
      .run();
    await say(e, chat, "🧾 <b>Verify receipt payment</b>\nOrder: <code>" + esc(String(order.checkout_code || order.id)) + "</code>\n" + (attachedReference ? "Backend sale clue: <code>" + esc(attachedReference) + "</code>\n" : "No backend Selar sale reference is attached yet.\n") + "\nCheck the payment in Selar, then send the <b>exact Selar reference only</b> as your next typed message. I will run the same duplicate/reuse checks as /verify. The screenshot and this button alone have <b>not</b> verified payment. This prompt expires in 10 minutes.", {
      inline_keyboard: [
        [{ text: "✖️ Cancel verification", callback_data: receiptReviewCallback("cancel", order) }],
        [{ text: "🚫 Reject & message client", callback_data: receiptReviewCallback("reject", order) }],
        [{ text: "⛔ Just reject", callback_data: receiptReviewCallback("rejectnow", order) }],
        [{ text: "🔎 Inspect order", callback_data: order.kind === "contact" ? "admin:request:" + order.id : "admin:service:" + order.id }]
      ]
    });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Send the exact Selar reference after checking Selar." });
  }
  if (data.startsWith("broadcast:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined || String(chat) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin private chat only." });
    const match = data.match(/^broadcast:(preview|send|cancel|continue|stop):([0-9a-f-]{36})$/i);
    if (!match) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid broadcast action." });
    const action = match[1].toLowerCase(), id = match[2];
    const draft = await e.DB.prepare("SELECT id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at FROM admin_broadcast_drafts WHERE id=?").bind(id).first<AdminBroadcastDraft>();
    if (!draft || draft.admin_telegram_id !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast draft not found." });
    if (draft.status === "sending" && (action === "preview" || action === "continue" || action === "stop")) {
      const counts = await broadcastRecipientCounts(e, id);
      if (!counts.total) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This older broadcast has no recipient ledger. Inspect /drafts; do not blind-retry." });
      if (action === "preview") {
        await say(e, chat, "📣 <b>Broadcast progress</b>\n" + formatBroadcastRecipientCounts(counts) + "\nCompleted clients will not receive duplicates.", broadcastProgressKeyboard(id));
        return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast progress loaded." });
      }
      if (action === "stop") {
        await stopBroadcastRemaining(e, actor, chat, draft);
        return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast stop processed." });
      }
      await processBroadcastBatch(e, draft, { chat, notifyProgress: true });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast batch processed." });
    }
    if (draft.status !== "draft") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: inactiveDraftMessage(draft.status, "This broadcast draft") });
    if (Date.parse(draft.expires_at.replace(" ", "T") + (draft.expires_at.endsWith("Z") ? "" : "Z")) < Date.now()) {
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(id).run();
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast draft expired." });
    }
    if (action === "cancel") {
      await e.DB.prepare("UPDATE admin_broadcast_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(id).run();
      await say(e, chat, "✖️ Broadcast cancelled. Nothing was sent.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast cancelled." });
    }
    if (action === "continue" || action === "stop") {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This broadcast has not started. Preview and confirm sending first." });
    }
    const recipientTotal = await broadcastAudienceCount(e, actor);
    if (action === "preview") {
      let mediaPreviewNote = "";
      if (draft.media_file_id) {
        try {
          await sendBroadcastToRecipient(e, draft, String(chat));
          mediaPreviewNote = "\nThe media and caption immediately above are the exact client preview. It was sent only to you.";
        } catch {
          mediaPreviewNote = "\n⚠️ Telegram could not preview the attached media. Check or replace it before sending.";
        }
      }
      await say(e, chat, "👀 <b>Broadcast preview</b>\nRecipients: " + recipientTotal + " unique saved client chats from all profile requests and service orders (your admin chat is excluded).\nDelivery: batches of " + BROADCAST_BATCH_SIZE + " with a saved per-client ledger; no client is sent this broadcast twice.\nMessage: " + (draft.message_text ? esc(draft.message_text) : "—") + "\nMedia: " + (draft.media_kind ? esc(draft.media_mime_type || draft.media_kind) : "none") + mediaPreviewNote + "\n\nNo client messages sent.", { inline_keyboard: [[{ text: "✅ Confirm and send", callback_data: "broadcast:send:" + id }], [{ text: "✖️ Cancel", callback_data: "broadcast:cancel:" + id }]] });
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
    const d=await e.DB.prepare("SELECT d.id,d.request_id,d.admin_telegram_id,d.checkout_code,d.message_text,d.media_kind,d.media_file_id,d.media_mime_type,d.status,d.expires_at,r.telegram_chat_id,r.profile_id,r.status AS request_status FROM delivery_drafts d JOIN contact_requests r ON r.id=d.request_id WHERE d.id=?").bind(draftId).first<any>();
    if (!d || String(d.admin_telegram_id)!==actor) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft not found for this admin."});
    if (draftAction==="cancel") {
      if(d.status!=="draft") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:inactiveDraftMessage(d.status,"This request-delivery draft")});
      await e.DB.prepare("UPDATE delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(? ,'delivery_draft_cancelled',?,?,?)").bind(actor,d.request_id,d.profile_id,"Admin cancelled unsent draft").run();
      await say(e,chat,"✖️ Draft cancelled. Nothing was sent.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft cancelled."});
    }
    if(d.status!=="draft") {
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:inactiveDraftMessage(d.status,"This request-delivery draft")});
    }
    if(isDraftExpired(d.expires_at)) {
      await e.DB.prepare("UPDATE delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"This request-delivery draft expired. Nothing was sent by this tap."});
    }
    if(d.request_status!=="payment_verified") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Payment or request state changed. Nothing was sent."});
    const body=String(d.message_text||"").trim();
    if(draftAction==="preview") {
      const preview="👀 <b>Delivery preview</b>\nRequest: <code>"+d.request_id+"</code>\nCheckout code: <code>"+esc(d.checkout_code||"")+"</code>\nProfile: <code>"+esc(d.profile_id)+"</code>\n\n🎊 Congratulations! Your payment has been verified and your request approved.\n\n"+(body?esc(body):"<i>No custom message added.</i>")+"\n\n"+(d.media_kind?"📎 One "+esc(d.media_mime_type||d.media_kind)+" attachment will be sent.":"No media attached.")+"\n\n<i>Preview only — nothing has been sent. No creator contact is stored or added automatically; the customer receives only the message/media you composed.</i>";
      await say(e,chat,preview,{inline_keyboard:[[ {text:"✅ Send to customer",callback_data:"draft:send:"+draftId},{text:"✖️ Cancel",callback_data:"draft:cancel:"+draftId} ]]});
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Preview only — nothing has been sent."});
    }
    if(!body && !d.media_file_id) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Add a message or media before sending."});
    if(d.media_file_id && d.media_kind!=="photo" && d.media_kind!=="document") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"The attached delivery media type is not supported. Nothing was sent."});
    const recipientLang=await customerLanguageForChat(e,d.telegram_chat_id);
    const deliveryText=tr(recipientLang,"requestDeliveryApproved")+(body?"\n\n"+esc(body):"");
    if(d.media_file_id && deliveryText.length>1024) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery text is too long for a Telegram media caption ("+deliveryText.length+"/1024). Shorten it, then preview again."});
    const claimed=await e.DB.prepare("UPDATE delivery_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND EXISTS (SELECT 1 FROM contact_requests r WHERE r.id=delivery_drafts.request_id AND r.status='payment_verified')").bind(draftId,actor).run();
    if(!claimed.meta?.changes) {
      const current=await e.DB.prepare("SELECT status FROM delivery_drafts WHERE id=?").bind(draftId).first<any>();
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:inactiveDraftMessage(current?.status || "changed","This request-delivery draft")});
    }
    try {
      if(d.media_file_id && d.media_kind==="photo") await tg(e,"sendPhoto",{chat_id:d.telegram_chat_id,photo:d.media_file_id,caption:deliveryText,parse_mode:"HTML"});
      else if(d.media_file_id && d.media_kind==="document" && /^video\//i.test(d.media_mime_type||"")) await tg(e,"sendVideo",{chat_id:d.telegram_chat_id,video:d.media_file_id,caption:deliveryText,parse_mode:"HTML"});
      else if(d.media_file_id && d.media_kind==="document") await tg(e,"sendDocument",{chat_id:d.telegram_chat_id,document:d.media_file_id,caption:deliveryText,parse_mode:"HTML"});
      else await say(e,d.telegram_chat_id,deliveryText);
    } catch {
      await notifyAdminIfConfigured(e,"⚠️ Delivery outcome is uncertain for request <code>"+d.request_id+"</code> / code <code>"+esc(d.checkout_code||"")+"</code>. Draft remains locked as sending to prevent duplicate delivery. Inspect Telegram before any manual retry.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery outcome uncertain. Draft locked to prevent duplicates."});
    }
    const finalStatus=await e.DB.prepare("UPDATE contact_requests SET status='approved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(d.request_id).run();
    await e.DB.prepare("UPDATE delivery_drafts SET status='sent',media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(? ,'delivery_sent',?,?,?)").bind(actor,d.request_id,d.profile_id,"Confirmed delivery draft sent through Telegram").run();
    if(!finalStatus.meta?.changes) await notifyAdminIfConfigured(e,"Delivery sent for request <code>"+d.request_id+"</code>, but status changed concurrently. Inspect audit before retrying.");
    else await sayBestEffort(e,chat,"✅ Delivery sent once for request <code>"+esc(d.checkout_code || d.request_id)+"</code>. The request is now <b>approved</b>. This draft is marked sent and will not send again.");
    return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery sent once and recorded."});
  }
  if (data.startsWith("service-delivery:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Admin access only."});
    const match=data.match(/^service-delivery:(preview|send|cancel):([0-9a-f-]{36})$/i);
    if(!match) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Unknown service delivery action."});
    const action=match[1].toLowerCase(), draftId=match[2];
    const d=await e.DB.prepare("SELECT d.id,d.service_order_id,d.admin_telegram_id,d.message_text,d.media_kind,d.media_file_id,d.media_mime_type,d.status,d.expires_at,o.telegram_chat_id,o.status AS order_status,o.checkout_code FROM service_delivery_drafts d JOIN service_orders o ON o.id=d.service_order_id WHERE d.id=?").bind(draftId).first<any>();
    if(!d || String(d.admin_telegram_id)!==actor) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft not found for this admin."});
    if(action==="cancel") {
      if(d.status!=="draft") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:inactiveDraftMessage(d.status,"This service-fulfilment draft")});
      const cancelled=await e.DB.prepare("UPDATE service_delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId,actor).run();
      if(!cancelled.meta?.changes) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft state changed; nothing was sent."});
      await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_delivery_draft_cancelled',?,?)").bind(actor,d.service_order_id,"Admin cancelled unsent fulfilment draft").run();
      await say(e,chat,"✖️ Service fulfilment draft cancelled. Nothing was sent.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Draft cancelled."});
    }
    if(d.status!=="draft") {
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:inactiveDraftMessage(d.status,"This service-fulfilment draft")});
    }
    if(isDraftExpired(d.expires_at)) {
      await e.DB.prepare("UPDATE service_delivery_drafts SET status='expired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft'").bind(draftId).run();
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"This service-fulfilment draft expired. Nothing was sent by this tap."});
    }
    if(d.order_status!=="payment_verified") return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Order is no longer awaiting fulfilment. Nothing was sent."});
    const context=await loadServiceDeliveryDraftContext(e,draftId);
    if(!context?.order) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Service order could not be reloaded. Nothing was sent."});
    if(action==="preview") {
      await sendServiceDeliveryDraftSummary(e,chat,context.draft,context.order,{heading:"👀 <b>Service fulfilment preview</b>",includeMediaPreview:true});
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Preview only — nothing has been sent."});
    }
    const recipientLang=await customerLanguage(e,String(context.order.telegram_user_id),context.order.telegram_chat_id);
    const problem=serviceDeliverySendProblem(context.draft,recipientLang);
    if(problem) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:problem});
    const claimed=await e.DB.prepare("UPDATE service_delivery_drafts SET status='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=? AND message_text IS ? AND media_kind IS ? AND media_file_id IS ? AND media_mime_type IS ? AND EXISTS(SELECT 1 FROM service_orders o WHERE o.id=service_delivery_drafts.service_order_id AND o.status='payment_verified')")
      .bind(draftId,actor,context.draft.message_text || "",context.draft.media_kind || null,context.draft.media_file_id || null,context.draft.media_mime_type || null).run();
    if(!claimed.meta?.changes) {
      const current=await loadServiceDeliveryDraft(e,draftId);
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:current && current.status!=="draft" ? inactiveDraftMessage(current.status,"This service-fulfilment draft") : "Service draft content or order state changed before sending. Preview it again."});
    }
    const body=serviceDeliveryBody(context.draft);
    try {
      if(context.draft.media_file_id && context.draft.media_kind==="photo") await tg(e,"sendPhoto",{chat_id:d.telegram_chat_id,photo:context.draft.media_file_id,caption:serviceDeliveryCaption(body,recipientLang)});
      else if(context.draft.media_file_id && context.draft.media_kind==="document" && /^video\//i.test(context.draft.media_mime_type||"")) await tg(e,"sendVideo",{chat_id:d.telegram_chat_id,video:context.draft.media_file_id,caption:serviceDeliveryCaption(body,recipientLang)});
      else if(context.draft.media_file_id && context.draft.media_kind==="document") await tg(e,"sendDocument",{chat_id:d.telegram_chat_id,document:context.draft.media_file_id,caption:serviceDeliveryCaption(body,recipientLang)});
      else await tg(e,"sendMessage",{chat_id:d.telegram_chat_id,text:tr(recipientLang,"serviceOrderReadyDetails")+"\n\n"+body,disable_web_page_preview:true});
    } catch {
      await notifyAdminIfConfigured(e,"⚠️ Service fulfilment outcome is uncertain for order <code>"+esc(d.service_order_id)+"</code>. Draft remains locked to prevent duplicate delivery. Inspect Telegram before any retry.");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Delivery outcome uncertain. Draft locked to prevent duplicates."});
    }
    const fulfilled=await e.DB.prepare("UPDATE service_orders SET status='fulfilled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(d.service_order_id).run();
    await e.DB.prepare("UPDATE service_delivery_drafts SET status='sent',media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='sending'").bind(draftId).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_order_fulfilled',?,?)").bind(actor,d.service_order_id,"Admin confirmed and sent service fulfilment; media="+(context.draft.media_file_id ? String(context.draft.media_kind || "file") : "none")+"; text_length="+body.length).run();
    if(!fulfilled.meta?.changes) await notifyAdminIfConfigured(e,"Service fulfilment was sent but order status changed concurrently. Inspect audit before retrying: <code>"+esc(d.service_order_id)+"</code>");
    else await sayBestEffort(e,chat,"✅ Service fulfilment sent once for order <code>"+esc(String(d.checkout_code||d.service_order_id))+"</code>. The order is now <b>fulfilled</b>; this draft is marked sent and will not send again.");
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
    const purpose = adminMessagePurpose(draft);

    if (await expireAdminMessageDraftIfNeeded(e, draft)) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft expired. Nothing was sent." });
    }

    if (action === "cancel") {
      if (draft.status !== "draft") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: inactiveDraftMessage(draft.status, "This customer-support draft") });
      const cancelled = await e.DB.prepare("UPDATE admin_message_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId, actor).run();
      if (!cancelled.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Support draft state changed; nothing was sent." });
      await auditAdminMessageDraft(e, actor, purpose === "rejection" ? "admin_rejection_draft_cancelled" : "admin_support_draft_cancelled", draft, order, "Admin cancelled unsent " + (purpose === "rejection" ? "rejection follow-up" : "customer support") + " draft for " + draft.order_kind + " order " + String(order?.checkout_code || draft.checkout_code || draft.order_id) + "; " + adminMessageContentDetails(draft));
      await say(e, chat, purpose === "rejection" ? "✖️ Rejection follow-up cancelled. Nothing was sent and the order was not rejected." : "✖️ Customer support draft cancelled. Nothing was sent.");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: purpose === "rejection" ? "Rejection draft cancelled; order unchanged." : "Support draft cancelled." });
    }

    if (draft.status !== "draft") {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: inactiveDraftMessage(draft.status, "This customer-support draft") });
    }
    if (!order || String(order.telegram_user_id) !== String(draft.telegram_user_id) || String(order.telegram_chat_id) !== String(draft.telegram_chat_id)) {
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "The selected order or customer destination changed. Nothing was sent." });
    }

    if (action === "preview") {
      await sendAdminMessageDraftSummary(e, chat, draft, order, { heading: purpose === "rejection" ? "👀 <b>Rejection follow-up preview</b>" : "👀 <b>Customer support preview</b>", includeMediaPreview: true });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: purpose === "rejection" ? "Preview only — order not rejected yet." : "Preview only — nothing has been sent." });
    }

    await executeSupportDraft(e, actor, chat, draftId);
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: purpose === "rejection" ? "Rejection send action processed." : "Support send action processed." });
  }
  if (data.startsWith("done:") || data.startsWith("paid:")) {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message || String(u.message.chat.id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openBotContinue") });
    const id = data.slice(data.indexOf(":") + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "invalidOrderReference") });
    const order = await loadCustomerOrderById(e, id);
    if (!order || String(order.telegram_user_id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "orderUnavailableAccount") });
    const outcome = await handlePaidClaim(e, actor, actor, order);
    const callbackText = outcome === "name_needed"
      ? tr(language, "callbackSendCheckoutName")
      : outcome === "sale_found"
        ? tr(language, "callbackSaleFound")
        : outcome === "receipt_needed"
          ? tr(language, "callbackNoPaymentRecord")
          : outcome === "receipt_already_forwarded"
            ? tr(language, "callbackReceiptWithAdmin")
            : outcome === "verified"
              ? tr(language, "callbackPaymentVerified")
              : tr(language, "callbackPaymentCheckComplete");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: callbackText });
  }
  if (data.startsWith("pay_")) {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    if (!u.message || String(u.message.chat.id) !== actor) {
      await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "openBotPaymentMethod") }); return;
    }
    const m = data.match(/^pay_selar:([0-9a-f-]{36})$/i);
    if (!m) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "invalidPaymentChoice") });
    const method = "selar", id = m[1];
    const r = await e.DB.prepare("SELECT id,status,telegram_user_id,telegram_chat_id,checkout_code FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!r || String(r.telegram_user_id) !== actor || r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "requestNoLongerWaitingPayment") });
    if (!enabledMethods(e).includes(method)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "paymentMethodNotConfigured") });
    if (method === "selar") {
      const checkout = new URL(e.SELAR_CHECKOUT_URL as string);
      checkout.searchParams.set("add_to_cart", "1");
      await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
      const markup = {
        inline_keyboard: [
          [{ text: tr(language, "openCheckout"), url: checkout.toString() }],
          [{ text: tr(language, "copyUniqueCode"), callback_data: `copycode:${id}` }],
          [{ text: tr(language, "doneCheckoutCompleted"), callback_data: `done:${id}` }],
          [{ text: tr(language, "paidCheckAgain"), callback_data: `paid:${id}` }]
        ]
      };
      await say(e, r.telegram_chat_id, tr(language, "contactCheckoutInstructions", { url: checkout.toString(), code: esc(r.checkout_code || "FL-7K4P9A"), exactCodeInstruction: tr(language, "exactCodeNoTrailingSpace") }), markup);
    }
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "checkoutInstructionsSent") }); return;
  }
  if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) {
    const language = actor === e.ADMIN_TELEGRAM_ID ? "en" : await customerLanguage(e, actor, chat);
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: tr(language, "notAuthorised") }); return;
  }
  if (data.startsWith("admin:")) {
    if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin access only." });
    const action = data.slice("admin:".length);
    if (action === "pending") {
      const rows = await e.DB.prepare("SELECT id,profile_id,status,checkout_code,payment_reference FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 12").all<any>();
      const buttons = (rows.results || []).map(r => [{ text: (r.status === "payment_verified" ? "🟢 Paid — review approval" : "🟡 Check payment") + " · " + String(r.checkout_code || "request"), callback_data: "admin:request:" + r.id }]);
      await say(e, chat, "<b>Requests needing attention</b>\nChoose a request to review its saved status. A sale notification is not payment verification.", { inline_keyboard: [...buttons, [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Requests loaded." });
    }
    if (action === "orders") {
      const rows = await e.DB.prepare("SELECT id,service_id,status,checkout_code,payment_reference FROM service_orders ORDER BY created_at DESC LIMIT 12").all<any>();
      const buttons = (rows.results || []).map(r => [{
        text: (r.status === "payment_verified" ? "🟢 Ready to fulfil" : r.status === "pending_payment" ? "🟡 Check payment" : "🧾 Inspect") + " · " + String(r.checkout_code || "service order"),
        callback_data: "admin:service:" + r.id
      }]);
      await say(e, chat, "<b>Recent service orders</b>\nChoose an order to inspect its saved status, payment evidence, drafts, and customer request text. A sale notification is not payment verification. For older/searchable records use /orders SEARCH or /order CODE_OR_UUID.", { inline_keyboard: [...buttons, [{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service orders loaded." });
    }
    if (action === "drafts") {
      const states = await listAdminDraftStates(e, actor, ["draft", "sending"]);
      if (!states.length) {
        await say(e, chat, "📝 <b>Admin drafts</b>\nNo editable or locked sending drafts are currently recorded. Use /order ORDER_CODE_OR_UUID to inspect sent/cancelled/expired draft state for a specific order.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
        return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No active drafts." });
      }
      const lines = ["📝 <b>Admin drafts (" + states.length + ")</b>"];
      const buttons: Record<string, unknown>[][] = [];
      for (const state of states) {
        lines.push("", "• <b>" + esc(adminComposerDisplayLabel(state)) + "</b> — <b>" + esc(state.status) + "</b> · <code>" + esc(String(state.checkoutCode || state.orderId || "broadcast audience")) + "</code>", "  Draft ID: <code>" + esc(state.draftId) + "</code> · updated " + esc(String(state.updatedAt || "unknown")) + " UTC");
        if (state.status === "draft" && buttons.length < 8) buttons.push([{ text: "✖️ Cancel " + adminComposerDisplayLabel(state), callback_data: adminComposerCancelCallback(state) }]);
        if (state.status === "sending") {
          if (state.kind === "broadcast") {
            const counts = await broadcastRecipientCounts(e, state.draftId);
            if (counts.total) {
              lines.push("  Broadcast delivery: sent " + counts.sent + ", failed " + counts.failed + ", uncertain " + counts.uncertain + ", remaining " + counts.pending + ", in flight " + counts.sending + ", cancelled " + counts.cancelled + ", total " + counts.total + ". Completed clients will not receive duplicates.");
              if (buttons.length < 8) buttons.push([{ text: "▶️ Continue broadcast", callback_data: "broadcast:continue:" + state.draftId }, { text: "⏹️ Stop remaining", callback_data: "broadcast:stop:" + state.draftId }]);
              continue;
            }
          }
          const lockedAt = draftExpiryMs(state.updatedAt);
          lines.push(Number.isFinite(lockedAt) && lockedAt <= Date.now() - 5 * 60 * 1000
            ? "  Inspect Telegram first; only if not delivered use <code>" + esc(adminComposerRecoveryCommand(state)) + "</code>."
            : "  Recent locked send: inspect Telegram and wait at least five minutes before recovery. Do not retry.");
        }
      }
      lines.push("", "Only one editable composer should be open. Use /drafts any time to reload this inspection.");
      buttons.push([{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]);
      await say(e, chat, lines.join("\n"), { inline_keyboard: buttons });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Drafts loaded." });
    }
    if (action === "broadcast_help") {
      const recipientTotal = await broadcastAudienceCount(e, actor);
      await say(e, chat, "<b>Broadcast to all clients</b>\nCurrent audience: <b>" + recipientTotal + "</b> unique saved client chats from all profile requests and service orders. Your admin chat is excluded.\n\nStart with:\n<code>/broadcast Your message here</code>\n\nYou can then replace the text or attach one photo, video, or PDF/image document. To send text and media together, either put the text in that media's Telegram caption after opening the draft, or send the media with caption <code>/broadcast Your message here</code>. The saved text travels as the media caption. Nothing is sent while composing. Tap <b>Preview audience and content</b> to see the exact media/caption, then <b>Confirm and send</b>.\n\nAt confirmation, the audience is snapshotted into a per-client delivery ledger and sent in batches of " + BROADCAST_BATCH_SIZE + ". Remaining batches continue automatically; /drafts also lets you continue or stop the remaining clients. Completed clients will not receive duplicates.\n\nFor one customer only, open their order and tap <b>Message this customer</b>, or use <code>/message FL-ABC123 Your message</code>.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Broadcast instructions opened." });
    }
    if (action === "message_help") {
      await say(e, chat, "<b>Message a customer</b>\nUse their FL- order code or full order UUID to open a private, expiring support draft. You can include text immediately or add it next; you may also attach one Telegram photo, video, or PDF/image document.\n\nExamples:\n<code>/message FL-ABC123 Hi, I’m checking your request and will update you here.</code>\n<code>/message FL-ABC123</code> — then send the text and/or attachment.\n\nNothing is sent while composing. Review the preview, then tap <b>Send to customer</b> or <b>Cancel</b>. This does not change payment, approval, delivery, or fulfilment status.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Customer-message instructions opened." });
    }
    if (action === "help") {
      await say(e, chat, "<b>Admin guide</b>\n• Review the real sale in Selar before confirming payment.\n• Payment confirmation and fulfilment delivery are separate actions.\n• Only one editable composer can be open across request delivery, service fulfilment, support, and broadcast; ordinary text/media edits only that composer.\n• Request/service fulfilment requires a manually verified payment, your composed message/media, preview, and the draft's explicit Send button. YES never becomes delivery text.\n• Use /order CODE_OR_UUID for full order inspection and /profile ID_OR_NAME for profile visibility/request counts.\n• Use /drafts to inspect editable/locked drafts. Recovery only cancels a stale lock after you inspect Telegram and confirms separately; it never resends.\n• Profile hiding is reversible; order closing/rejection retains records for audit. Only confirmed /deleteorder and /clearorders actions permanently delete order rows and their linked prompts/receipts/drafts; audit and used payment-reference records remain.\n• Use /help for all supported commands.\n• The admin assistant can prepare deletions, pending-order closures, fulfilment prompts, and message/broadcast drafts for your confirmation. It cannot verify payments, approve or send delivery by itself, or delete/hide profiles.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin guide opened." });
    }
    if (action === "home") {
      await say(e, chat, "<b>Admin Desk</b>\nChoose an action:", { inline_keyboard: [[{ text: "📥 Review requests", callback_data: "admin:pending" }], [{ text: "🧾 Review service orders", callback_data: "admin:orders" }], [{ text: "📝 Drafts & recovery", callback_data: "admin:drafts" }], [{ text: "📣 Broadcast to all clients", callback_data: "admin:broadcast_help" }], [{ text: "💬 How to message a customer", callback_data: "admin:message_help" }], [{ text: "🗑️ Clear orders permanently", callback_data: "admin:clear_orders" }], [{ text: "🤖 Admin assistant (AI tasks)", callback_data: "admin:assistant_help" }], [{ text: "📘 Admin guide & safeguards", callback_data: "admin:help" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin menu." });
    }
    if (action === "clear_orders") {
      await sendClearOrdersScopeChooser(e, actor, chat);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Choose a deletion scope. Nothing deleted yet." });
    }
    const clearOrdersMatch = action.match(/^clearorders:(pending|finished|all)$/i);
    if (clearOrdersMatch) {
      await prepareBulkOrderDeletion(e, actor, chat, clearOrdersMatch[1].toLowerCase() as OrderDeletionScope);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Review the exact deletion preview. Nothing deleted yet." });
    }
    if (action === "assistant_help") {
      await say(e, chat, "<b>🤖 Admin assistant</b>\nIn this private admin chat you can type requests such as:\n• <code>Delete order FL-ABC123</code>\n• <code>Clear all pending orders</code> or <code>Clear all orders</code>\n• <code>Write a friendly message to customer FL-ABC123 telling them…</code>\n• <code>Write a broadcast announcing…</code>\n• <code>Inspect FL-ABC123</code> or <code>Show service orders</code>\n\nThe assistant only prepares work: deletions and pending-order closures still need your Confirm button or typed YES, and customer/broadcast text opens a draft that you preview and explicitly send. It cannot verify payments, approve or send fulfilment by itself, or delete/hide profiles. Profile hiding stays manual with <code>/hideprofile PROFILE_ID</code>.\n\nIf a composer is already open, your ordinary text edits that draft instead, so finish or cancel it first. Voice transcripts cannot start deletions or closures; type those requests.", { inline_keyboard: [[{ text: "↩️ Back to Admin Desk", callback_data: "admin:home" }]] });
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin assistant instructions opened." });
    }
    const deleteOrderMatch = action.match(/^deleteorder:(contact|service):([0-9a-f-]{36})$/i);
    if (deleteOrderMatch) {
      const kind = deleteOrderMatch[1].toLowerCase() as OrderKind;
      const order = await loadCustomerOrderByKind(e, kind, deleteOrderMatch[2]);
      if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Order not found." });
      await prepareSingleOrderDeletion(e, actor, chat, order);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Review the permanent-deletion confirmation. Nothing deleted yet." });
    }
    const customerMessageMatch = action.match(/^message:(contact|service):([0-9a-f-]{36})$/i);
    if (customerMessageMatch) {
      const kind = customerMessageMatch[1].toLowerCase() as OrderKind;
      const order = await loadCustomerOrderByKind(e, kind, customerMessageMatch[2]);
      if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Order not found." });
      await createOrReopenAdminMessageDraft(e, { chat: { id: Number(chat) }, from: { id: Number(actor) } } as Msg, order.id, "");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Customer-message composer processed. Nothing sent yet." });
    }
    const requestMatch = action.match(/^request:([0-9a-f-]{36})$/i);
    if (requestMatch) {
      const order = await loadCustomerOrderByKind(e, "contact", requestMatch[1]);
      if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request not found." });
      await sendAdminOrderInspection(e, chat, order, false);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request details opened." });
    }
    const serviceDeliverMatch = action.match(/^service-deliver:([0-9a-f-]{36})$/i);
    if (serviceDeliverMatch) {
      const order = await loadCustomerOrderByKind(e, "service", serviceDeliverMatch[1]);
      if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service order not found." });
      await createOrReopenServiceDeliveryDraft(e, actor, chat, order, "");
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service fulfilment composer processed. Nothing sent yet." });
    }
    const serviceMatch = action.match(/^service:([0-9a-f-]{36})$/i);
    if (serviceMatch) {
      const order = await loadCustomerOrderByKind(e, "service", serviceMatch[1]);
      if (!order) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service order not found." });
      await sendAdminOrderInspection(e, chat, order, true);
      return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service order details opened." });
    }
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown admin menu action." });
  }
  // All payment-verification, approval, and rejection callbacks are admin-only.
  if (actor !== e.ADMIN_TELEGRAM_ID) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Admin access only." });
  const m = data.match(/^(approve|reject|selarverify|serviceverify):([0-9a-f-]{36})$/i);
  if (!m) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown action." }); return; }
  const action = m[1].toLowerCase(), id = m[2];
  if (action === "serviceverify") {
    const service = await e.DB.prepare("SELECT id,telegram_chat_id,status,payment_method,payment_reference,checkout_code FROM service_orders WHERE id=?").bind(id).first<any>();
    if (!service || service.status !== "pending_payment" || service.payment_method !== "selar" || !service.payment_reference) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No service payment notification is attached." });
    const updateRes = await e.DB.prepare("UPDATE service_orders SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
    if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Service payment was already verified." });
    await deleteReceiptVerifyPrompt(e, actor, { kind: "service", id });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_payment_admin_verified',?,?)").bind(actor, id, `Admin manually confirmed Selar payment; reference ${service.payment_reference}`).run();
    await sayBestEffort(e, service.telegram_chat_id, tr(await customerLanguageForChat(e, service.telegram_chat_id), "paymentConfirmedService"));
    await say(e, e.ADMIN_TELEGRAM_ID, "Payment manually confirmed for service order <code>" + esc(String(service.checkout_code || id)) + "</code>. Use /deliver " + esc(String(service.checkout_code || id)) + " to open the fulfilment composer when ready, or inspect it with /order " + esc(String(service.checkout_code || id)) + ".", { inline_keyboard: [[{ text: "📝 Prepare service fulfilment", callback_data: "admin:service-deliver:" + id }], [{ text: "🔎 Inspect service order", callback_data: "admin:service:" + id }]] });
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
    await deleteReceiptVerifyPrompt(e, actor, { kind: "contact", id });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'selar_payment_admin_verified',?,?,?)").bind(actor, id, r.profile_id, `Admin reviewed webhook-backed Selar payment before approving; reference ${paid.payment_reference}`).run();
    await sayBestEffort(e, r.telegram_chat_id, tr(await customerLanguageForChat(e, r.telegram_chat_id), "paymentNotificationCheckedContact"));
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Next, prepare your delivery message/media for this exact customer and explicitly confirm sending.", { inline_keyboard: [[{ text: "🔓 Prepare delivery", callback_data: "approve:" + id }, { text: "Reject", callback_data: "reject:" + id }]] });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment verified. Review the request next." });
  }
  if (action === "reject") {
    if (!["pending_payment", "payment_verified"].includes(r.status)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is no longer pending." });
    const updateRes = await e.DB.prepare("UPDATE contact_requests SET status='rejected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN('pending_payment','payment_verified')").bind(id).run();
    if (!updateRes.meta?.changes) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request status already changed." });
    await deleteReceiptVerifyPrompt(e, actor, { kind: "contact", id });
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'reject_request',?,?)").bind(actor, id, r.profile_id).run();
    await say(e, r.telegram_chat_id, tr(await customerLanguageForChat(e, r.telegram_chat_id), "requestRejectedRefund"));
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Rejected." });
  }
  if (r.status !== "payment_verified") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment is not verified." });
  const conflicts = await adminComposerConflicts(e, actor, { kind: "request_delivery", orderId: id, orderKind: "contact" });
  if (conflicts.length) {
    await replyAdminComposerConflict(e, chat, conflicts, "preparing this request delivery");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Another composer is already open. Nothing was changed." });
  }
  const oldDraft = await e.DB.prepare("SELECT id,status,message_text,media_kind,media_file_id,media_mime_type,expires_at FROM delivery_drafts WHERE request_id=?").bind(id).first<any>();
  if (oldDraft && (oldDraft.status === "sent" || oldDraft.status === "sending")) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: inactiveDraftMessage(oldDraft.status, "This request-delivery draft") });
  const draftId = oldDraft?.id || crypto.randomUUID();
  const reopenedExistingDraft = Boolean(oldDraft && oldDraft.status === "draft" && !isDraftExpired(oldDraft.expires_at));
  const createdOrReopenedDraft = !reopenedExistingDraft;
  if (reopenedExistingDraft) {
    // A stale Prepare button must never erase the admin's current text/media.
    await e.DB.prepare("UPDATE delivery_drafts SET admin_telegram_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),expires_at=datetime('now','+30 minutes') WHERE id=? AND status='draft'").bind(actor,draftId).run();
  } else if (oldDraft) {
    await e.DB.prepare("UPDATE delivery_drafts SET status='draft',admin_telegram_id=?,message_text=NULL,media_kind=NULL,media_file_id=NULL,media_mime_type=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),expires_at=datetime('now','+30 minutes') WHERE id=? AND status IN('cancelled','expired')").bind(actor,draftId).run();
  } else {
    await e.DB.prepare("INSERT INTO delivery_drafts(id,request_id,admin_telegram_id,checkout_code,status,expires_at) SELECT ?,id,?,checkout_code,'draft',datetime('now','+30 minutes') FROM contact_requests WHERE id=? AND status='payment_verified'").bind(draftId,actor,id).run();
  }
  const draft = await e.DB.prepare("SELECT id,checkout_code,message_text,media_kind,media_file_id,media_mime_type FROM delivery_drafts WHERE id=? AND admin_telegram_id=? AND status='draft'").bind(draftId,actor).first<any>();
  if (draft && createdOrReopenedDraft) {
    const racedConflicts = await adminComposerConflicts(e, actor, { kind: "request_delivery", draftId });
    if (racedConflicts.length) {
      await e.DB.prepare("UPDATE delivery_drafts SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' AND admin_telegram_id=?").bind(draftId,actor).run();
      await replyAdminComposerConflict(e, chat, racedConflicts, "preparing this request delivery");
      return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Another composer opened first. Nothing was sent."});
    }
  }
  if (!draft) return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:"Could not create a draft. Request state may have changed."});
  const draftContentNote = reopenedExistingDraft
    ? "Existing draft reopened with its current content preserved. Text: " + (String(draft.message_text || "").trim() ? "yes" : "no") + ". Media: " + (draft.media_file_id ? esc(String(draft.media_mime_type || draft.media_kind || "attached")) : "none") + ". Ordinary text will replace the text; ordinary media will replace the attachment."
    : "Send the message and/or media you want the customer to receive (text up to 700 characters; one photo, video, or PDF/image document).";
  await say(e,chat,"📝 <b>Delivery draft</b>\nRequest: <code>"+id+"</code>\nCheckout code: <code>"+esc(draft.checkout_code || "unknown")+"</code>\nProfile: <code>"+esc(r.profile_id)+"</code>\n\n"+draftContentNote+" Then preview and explicitly send.\n\nNo creator contact is stored or added automatically. Expires in 30 minutes. Nothing has been sent.",{inline_keyboard:[[ {text:"👀 Preview",callback_data:"draft:preview:"+draftId} ],[ {text:"✖️ Cancel",callback_data:"draft:cancel:"+draftId} ]]});
  return tg(e,"answerCallbackQuery",{callback_query_id:u.id,text:reopenedExistingDraft ? "Existing draft reopened; content preserved." : "Draft opened. No customer message sent."});
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

  // Only two forms of decisive reconciliation evidence may attach a sale:
  // a unique FL checkout code, or—only when no code was supplied—a distinctive
  // exact normalized checkout name already saved on exactly one pending order.
  // Email and price are never matching evidence.
  const saleName = s.customerName.replace(new RegExp("\\s*" + (code || "") + "\\s*$", "i"), "").trim();
  const fullName = normName(saleName);
  if (code) {
    const codeRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,telegram_username,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
    if (codeRows.results.length === 1) {
      const candidate = codeRows.results[0];
      // If the customer already supplied their checkout name, require both the
      // code and the normalized full name to agree before attaching this sale.
      if (!candidate.checkout_name || normName(String(candidate.checkout_name)) === fullName) {
        target = candidate;
        matchedBy = "unique_code";
      }
    }
  }

  if (!target && !code) {
    if (fullName.length >= 5 && fullName.includes(" ")) {
      const nameRows = kind === "contact"
        ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,telegram_username,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE status='pending_payment' AND payment_method='selar' AND checkout_name IS NOT NULL").all<any>()
        : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE status='pending_payment' AND checkout_name IS NOT NULL").all<any>();
      const exactNameRows = nameRows.results.filter((row: any) => row.checkout_name && normName(row.checkout_name) === fullName);
      if (exactNameRows.length === 1) {
        target = exactNameRows[0];
        matchedBy = "exact_full_name";
      }
    }
  }

  if (!target) return json({ ok: true, matched: false, reason: "no_unique_code_or_name_match" });

  const saleInserted = await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email || target.buyer_email || "", 0, "UNK", s.productId, target.id).run();
  if (saleInserted.meta?.changes === 0) return json({ ok: true, duplicate: true });

  const effectiveCode = target.checkout_code || code || "unknown";
  const matchLabel = matchedBy === "unique_code" ? "unique checkout code" : "exact full saved checkout name";
  const clueNote = "\n\n<i>Matched by " + matchLabel + ". This is only a reconciliation match; an administrator must verify the payment directly in Selar.</i>";

  try {
    if (kind === "contact") {
      const upd = await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "✅ I checked Selar — confirm payment", callback_data: "selarverify:" + target.id }, { text: "Reject request", callback_data: "reject:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nSource: FansLeak website → model Subscribe button\nCheckout product: profile request (<code>${esc(e.SELAR_PRODUCT_ID || "")}</code>)\nRequest: <code>${target.id}</code>\nProfile: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nTelegram username: ${target.telegram_username ? "@" + esc(String(target.telegram_username).replace(/^@+/, "")) : "not provided"}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
      await sayBestEffort(e, target.telegram_chat_id, tr(await customerLanguageForChat(e, target.telegram_chat_id), "paymentNotificationReceivedContact"));
    } else {
      const upd = await e.DB.prepare("UPDATE service_orders SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "✅ I checked Selar — confirm service payment", callback_data: "serviceverify:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nSource: ${String(target.profile_id) === "telegram_channel" ? "Telegram bot → View our services → Subscribe button" : "Telegram bot service chat"}\nCheckout product: service checkout (<code>${esc(e.SERVICE_PRODUCT_ID || "")}</code>)\nOrder: <code>${target.id}</code>\nService: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nTelegram username: ${target.telegram_username ? "@" + esc(String(target.telegram_username).replace(/^@+/, "")) : "not provided"}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
      await sayBestEffort(e, target.telegram_chat_id, tr(await customerLanguageForChat(e, target.telegram_chat_id), "paymentNotificationReceivedService"));
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
  try {
    await say(e, target.telegram_chat_id, tr(await customerLanguageForChat(e, target.telegram_chat_id), "abandonedCartReminder"));
  } catch (err) {
    await e.DB.prepare("DELETE FROM processed_abandoned_carts WHERE event_key=?").bind(eventId).run();
    throw err;
  }
  return json({ ok: true, matched: true, reminder_sent: true });
}


async function expireOldPendingOrders(e: Env) {
  const contacts = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_code FROM contact_requests WHERE status IN('awaiting_email','pending_payment','awaiting_bank_reference') AND payment_reference IS NULL AND manual_payment_reference IS NULL AND datetime(created_at)<=datetime('now','-48 hours') ORDER BY created_at ASC LIMIT 100").all<any>();
  const services = await e.DB.prepare("SELECT id,telegram_chat_id,checkout_code FROM service_orders WHERE status IN('awaiting_request','awaiting_email','pending_payment') AND payment_reference IS NULL AND datetime(created_at)<=datetime('now','-48 hours') ORDER BY created_at ASC LIMIT 100").all<any>();
  for (const order of contacts.results || []) {
    try {
      await say(e, order.telegram_chat_id, tr(await customerLanguageForChat(e, order.telegram_chat_id), "expiredContactOrder", { code: esc(String(order.checkout_code || order.id)) }));
    } catch { continue; }
    await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM payment_receipt_submissions WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM delivery_drafts WHERE request_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM admin_message_drafts WHERE order_id=? AND order_kind='contact'").bind(order.id).run();
    await e.DB.prepare("DELETE FROM processed_sales WHERE request_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM contact_requests WHERE id=? AND payment_reference IS NULL AND manual_payment_reference IS NULL AND status IN('awaiting_email','pending_payment','awaiting_bank_reference')").bind(order.id).run();
  }
  for (const order of services.results || []) {
    try {
      await say(e, order.telegram_chat_id, tr(await customerLanguageForChat(e, order.telegram_chat_id), "expiredServiceOrder", { code: esc(String(order.checkout_code || order.id)) }));
    } catch { continue; }
    await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM receipt_review_prompts WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM payment_receipt_submissions WHERE order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM service_delivery_drafts WHERE service_order_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM admin_message_drafts WHERE order_id=? AND order_kind='service'").bind(order.id).run();
    await e.DB.prepare("DELETE FROM processed_sales WHERE request_id=?").bind(order.id).run();
    await e.DB.prepare("DELETE FROM service_orders WHERE id=? AND payment_reference IS NULL AND status IN('awaiting_request','awaiting_email','pending_payment')").bind(order.id).run();
  }
}

export default {
  async scheduled(controller: unknown, env: Env): Promise<void> {
    const cron = String((controller as { cron?: unknown } | null)?.cron || "");
    if (!cron || cron === "0 * * * *") await expireOldPendingOrders(env);
    try {
      await processScheduledBroadcasts(env);
    } catch (err) {
      console.error("Scheduled broadcast batch failed", String(err));
    }
  },
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
