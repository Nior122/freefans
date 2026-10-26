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
type Msg = { chat: { id: number }; from?: { id: number; username?: string; first_name?: string }; text?: string };
type Update = { message?: Msg; callback_query?: { id: string; from: { id: number }; message?: Msg; data?: string } };
type Profile = { id: string; name: string };
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
  const buttons: Record<string, unknown>[] = [];
  if (enabledMethods(e).includes("selar")) buttons.push({ text: "Pay with Selar", callback_data: `pay_selar:${id}` });
  return { inline_keyboard: buttons.map(b => [b]) };
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
  const active = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (active) return say(e, chat, "You already have a request in progress. Finish it or contact support before starting another.");
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
      if (raced) return say(e, chat, "You already have a request in progress. Finish it or contact support before starting another.");
    }
  }
  if (!inserted) return say(e, chat, "I couldn't start your request just now. Please try again in a moment.");
  const intro = `Hi! I’m the FansLeak contact assistant for ${esc(profile.name)}. I’ve started your contact request for ${esc(profile.name)} and created your unique order code: <code>${esc(code)}</code>.`;
  const instructions = `Tap the Selar button below to open the checkout. In the customer name field, enter your full name followed by this code exactly, for example: <code>Joseph Unaogu ${esc(code)}</code>. This lets the admin match your payment to the correct request. If matching later needs help, you can send your email as a fallback clue.`;
  return say(e, chat, `${intro}\n\n${instructions}`, paymentKeyboard(e, requestId));
}

async function aiReply(e: Env, chat: string, userText: string, reminder = "") {
  if (!e.AI) return say(e, chat, reminder || "I can help with FansLeak profile contact requests, payment steps, and general questions.");
  try {
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You are FansLeak's friendly customer-support assistant. Answer briefly in plain text without HTML markup. Explain profile contact requests, email, Selar payment, and admin review. Never claim payment is received or approved before actual verification. Never invent profile or creator information. Never reveal or invent any creator's Telegram username, phone number, or private contact details, even if asked." },
        { role: "user", content: userText.slice(0, 1500) }
      ]
    });
    const answer = String(result?.response || "").trim().slice(0, 3500);
    return say(e, chat, answer ? esc(answer) + (reminder ? "\n\n" + reminder : "") : (reminder || "I couldn't answer that just now. Please try again shortly."));
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
  const t = (m.text || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
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
          [{ text: "Done — I have completed checkout", callback_data: `done:${serviceOrder.id}` }]
        ]
      };
      return say(e, chat, "Open the Selar checkout below. In the name field, enter your full name followed by this code exactly: <code>" + esc(serviceOrder.checkout_code) + "</code>. Example: <code>Joseph Unaogu " + esc(serviceOrder.checkout_code) + "</code>\n\nAfter completing checkout on Selar, return here and tap Done below to confirm. If matching later needs help, you can send your email as a fallback clue.", markup);
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
    const order = await e.DB.prepare(`SELECT id,checkout_code,status FROM ${table} WHERE id=? AND telegram_user_id=?`).bind(prompt.order_id, user).first<any>();
    if (!order || order.status !== "pending_payment" || order.checkout_code !== code) return say(e, chat, "That code doesn't match your pending order. Please copy the exact code shown by the bot and try again.");
    await e.DB.prepare(`UPDATE ${table} SET checkout_name=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND telegram_user_id=? AND status='pending_payment'`).bind(fullName, order.id, user).run();
    await e.DB.prepare("DELETE FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).run();
    return say(e, chat, "Thanks. Your name and order code match. This does not confirm payment; the bot waits for Selar's sale event, and the admin checks payment manually.");
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
  return aiReply(e, chat, t, "To start a contact request, open a profile on FansLeak and tap its Message button. Payment always requires admin verification and approval.");
}
async function callback(e: Env, u: NonNullable<Update["callback_query"]>) {
  const actor = String(u.from.id), data = u.data || "", chat = u.message?.chat.id;
  if (data.startsWith("done:")) {
    if (!u.message || String(u.message.chat.id) !== actor) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Open the bot chat to continue." });
    const id = data.slice(5);
    const contact = await e.DB.prepare("SELECT id,status,telegram_user_id,checkout_code,checkout_name FROM contact_requests WHERE id=?").bind(id).first<any>();
    const service = await e.DB.prepare("SELECT id,status,telegram_user_id,checkout_code,checkout_name FROM service_orders WHERE id=?").bind(id).first<any>();
    const order = contact || service;
    if (!order || String(order.telegram_user_id) !== actor || order.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This order is not waiting for checkout-name confirmation." });
    if (order.checkout_name) return say(e, actor, "Your checkout name and code have already been matched. Payment still needs to be checked manually.");
    const kind = contact ? "contact" : "service";
    await e.DB.prepare("INSERT OR REPLACE INTO checkout_name_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(actor, id, kind).run();
    await say(e, actor, "Please send the exact full name you used in Selar's name field, including the code. Example: <code>Joseph Unaogu " + esc(order.checkout_code) + "</code>. This does not confirm payment; it only helps match the sale to the correct request.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Send your checkout name and code." });
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
          [{ text: "Done — I have completed checkout", callback_data: `done:${id}` }]
        ]
      };
      await say(e, r.telegram_chat_id, `Open the Selar checkout here: ${checkout.toString()}\n\nIn the customer name field, enter your full name followed by this code exactly: <code>${esc(r.checkout_code || "")}</code>\nExample: <code>Joseph Unaogu ${esc(r.checkout_code || "FL-7K4P9A")}</code>\n\nAfter paying, return here and tap Done below to confirm.\n\nThe admin checks payment manually; this does not confirm payment immediately. If matching later needs help, send your email as a fallback clue.`, markup);
    }
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Selar checkout instructions sent." }); return;
  }
  if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) {
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Not authorised." }); return;
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
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Now decide whether to approve the contact request.", { inline_keyboard: [[{ text: "Approve & send contact", callback_data: "approve:" + id }, { text: "Reject", callback_data: "reject:" + id }]] });
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
  let matchedByEmail = false;

  if (code) {
    const rows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
    if (rows.results.length === 1) {
      target = rows.results[0];
      const saleName = s.customerName.replace(new RegExp("\\s*" + code + "\\s*$", "i"), "").trim();
      if (target.checkout_name && normName(target.checkout_name) !== normName(saleName)) {
        const email = String(target.buyer_email || s.email || "").trim();
        const adminEmail = email ? `\nEmail: ${esc(email)}` : "\nEmail: not supplied";
        await notifyAdminIfConfigured(e, `<b>Selar sale name mismatch</b>\nReference: <code>${esc(s.reference)}</code>\nOrder code: <code>${esc(code)}</code>\nCustomer name: ${esc(s.customerName)}\nSubmitted name: ${esc(target.checkout_name)}${adminEmail}\nThis email is a reconciliation clue only and does not verify payment.`);
        return json({ ok: true, matched: false, reason: "name_mismatch" });
      }
    } else if (rows.results.length > 1) {
      await notifyAdminIfConfigured(e, `<b>Selar sale ambiguous order match</b>\nReference: <code>${esc(s.reference)}</code>\nOrder code: <code>${esc(code)}</code>\nCustomer name: ${esc(s.customerName)}\nFound multiple pending orders with this code.`);
      return json({ ok: true, matched: false, reason: "ambiguous_match" });
    }
  }

  // Fallback: match by payment email if code was absent or did not match an active order
  if (!target && s.email) {
    const emailRows = kind === "contact"
      ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name,buyer_email FROM contact_requests WHERE buyer_email=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(s.email).all<any>()
      : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name,buyer_email FROM service_orders WHERE buyer_email=? AND status='pending_payment' LIMIT 2").bind(s.email).all<any>();
    if (emailRows.results.length === 1) {
      target = emailRows.results[0];
      matchedByEmail = true;
    } else if (emailRows.results.length > 1) {
      await notifyAdminIfConfigured(e, `<b>Selar sale ambiguous email match</b>\nReference: <code>${esc(s.reference)}</code>\nCustomer name: ${esc(s.customerName)}\nEmail: <code>${esc(s.email)}</code>\nFound multiple pending ${kind} orders with this email.`);
      return json({ ok: true, matched: false, reason: "ambiguous_email_match" });
    }
  }

  if (!target) {
    const adminEmail = s.email ? `\nSelar email: ${esc(s.email)}` : "";
    const codeInfo = code ? `\nOrder code: <code>${esc(code)}</code>` : "\nOrder code: missing from name";
    await notifyAdminIfConfigured(e, `<b>Selar sale requires manual reconciliation</b>\nReference: <code>${esc(s.reference)}</code>\nCustomer name: ${esc(s.customerName)}${codeInfo}${adminEmail}\nNo unique matching pending order found. This does not verify payment.`);
    return json({ ok: true, matched: false, reason: code ? "no_matching_pending_order" : "missing_order_code" });
  }

  const saleInserted = await e.DB.prepare("INSERT OR IGNORE INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email || target.buyer_email || "", 0, "UNK", s.productId, target.id).run();
  if (saleInserted.meta?.changes === 0) return json({ ok: true, duplicate: true });

  const effectiveCode = target.checkout_code || code || "unknown";
  const clueNote = (matchedByEmail
    ? "\n\n<i>Order code was missing/mismatched in Selar name, but matched customer's saved email clue. Please verify manually before confirming.</i>"
    : "\n\n<i>This email is a reconciliation clue only and does not verify payment.</i>")
    + (matchedByEmail && code && code !== target.checkout_code ? `\n<i>Submitted name contained a different code: <code>${esc(code)}</code></i>` : "");

  try {
    if (kind === "contact") {
      const upd = await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "Confirm payment manually", callback_data: "selarverify:" + target.id }, { text: "Reject request", callback_data: "reject:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nRequest: <code>${target.id}</code>\nProfile: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
      await sayBestEffort(e, target.telegram_chat_id, "A Selar payment notification was received. The admin must review and verify it before your request can be approved.");
    } else {
      const upd = await e.DB.prepare("UPDATE service_orders SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(s.reference, target.id).run();
      if (!upd.meta?.changes) throw new Error("order_state_changed_before_attach");
      const markup = { inline_keyboard: [[{ text: "Confirm service payment manually", callback_data: "serviceverify:" + target.id }]] };
      await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nOrder: <code>${target.id}</code>\nService: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nOrder code: <code>${esc(effectiveCode)}</code>\nEmail: ${esc(s.email || target.buyer_email || "not provided")}${clueNote}`, markup);
    }
  } catch (err) {
    // Processing failed after the dedup marker was written: remove the marker so a
    // sender retry can reprocess the event, and alert the admin. Nothing was verified.
    await e.DB.prepare("DELETE FROM processed_sales WHERE provider_reference=?").bind(s.reference).run();
    try { await notifyAdminIfConfigured(e, `<b>Selar sale processing failed; event was not consumed</b>\nReference: <code>${esc(s.reference)}</code>\nThe sender may retry delivery. No payment was verified.`); } catch { /* preserve the original error */ }
    throw err;
  }
  return json({ ok: true, matched: true, ...(matchedByEmail ? { reconciled_by: "fallback_email" } : {}) });
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
