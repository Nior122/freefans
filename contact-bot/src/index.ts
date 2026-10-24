interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface D1Database { prepare(query: string): D1PreparedStatement; }

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_ID: string;
  CONTACT_PRICE_NGN: string;
  PAYMENT_PROVIDER?: string;
  PAYMENT_METHODS?: string;
  SITE_URL?: string;
  SELAR_CHECKOUT_URL?: string;
  SELAR_WEBHOOK_SECRET?: string;
  SELAR_PRODUCT_ID?: string;
  BANK_PAYMENT_URL?: string;
  AI?: { run(model: string, input: { messages: Array<{ role: string; content: string }> }): Promise<{ response?: string }> };
  AI_MODEL?: string;
}
type Msg = { chat: { id: number }; from?: { id: number; username?: string; first_name?: string }; text?: string };
type Update = { message?: Msg; callback_query?: { id: string; from: { id: number }; message?: Msg; data?: string } };
type Profile = { id: string; name: string; handle: string };
type RequestRow = { id: string; telegram_chat_id: string; profile_id: string; status: string; buyer_email?: string; manual_payment_reference?: string };
const headers = { "content-type": "application/json; charset=utf-8" };
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
function safeEq(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
const price = (e: Env) => { const n = Number(e.CONTACT_PRICE_NGN); return Number.isFinite(n) && n > 0 ? n : null; };
const money = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(n);
const provider = (e: Env) => (e.PAYMENT_PROVIDER || "selar").trim().toLowerCase();
const methods = (e: Env) => (e.PAYMENT_METHODS || "selar,bank").split(",").map(x => x.trim().toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
function enabledMethods(e: Env) {
  const configured: string[] = [];
  if (methods(e).includes("selar") && provider(e) === "selar" && e.SELAR_CHECKOUT_URL) configured.push("selar");
  if (methods(e).includes("bank") && e.BANK_PAYMENT_URL) configured.push("bank");
  return configured;
}
async function tg(e: Env, method: string, data: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const j = await r.json() as { ok?: boolean; description?: string };
  if (!r.ok || !j.ok) throw new Error(`Telegram ${method} failed: ${j.description || r.status}`);
  return j;
}
async function say(e: Env, chat: string | number, text: string, markup?: unknown) {
  return tg(e, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
}
async function catalogue(e: Env): Promise<Profile[]> {
  const r = await fetch(`${(e.SITE_URL || "https://fansleak.pages.dev").replace(/\/$/, "")}/contact-catalogue.json`);
  if (!r.ok) throw new Error("profile catalogue unavailable");
  const j = await r.json() as { profiles?: Profile[] };
  if (!Array.isArray(j.profiles)) throw new Error("invalid catalogue");
  return j.profiles;
}
function paymentKeyboard(e: Env, id: string) {
  const buttons: Record<string, unknown>[] = [];
  if (enabledMethods(e).includes("selar")) buttons.push({ text: "Pay with Selar", callback_data: `pay_selar:${id}` });
  if (enabledMethods(e).includes("bank")) buttons.push({ text: "Bank transfer / payment link", callback_data: `pay_bank:${id}` });
  return { inline_keyboard: buttons.map(b => [b]) };
}
async function start(e: Env, m: Msg, payload: string) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id), id = payload.replace(/^contact_/, "");
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(id)) return say(e, chat, "Invalid profile link. Open the Message button directly from FansLeak.");
  let profile: Profile | undefined;
  try { profile = (await catalogue(e)).find(p => p.id === id); }
  catch { return say(e, chat, "I can't load the live FansLeak profile list right now. Try again shortly."); }
  if (!profile) return say(e, chat, "That profile is not currently in the public FansLeak catalogue.");
  if (!price(e) || enabledMethods(e).length === 0) {
    await say(e, chat, "Contact requests are not accepting payments yet. Please try again later.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Setup required: configure CONTACT_PRICE_NGN and at least one enabled payment method URL.");
    return;
  }
  const active = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','awaiting_bank_reference','pending_manual_payment','payment_verified') LIMIT 1").bind(user).first();
  if (active) return say(e, chat, "You already have a request in progress. Finish it or contact support before starting another.");
  const requestId = crypto.randomUUID();
  await e.DB.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,telegram_username,profile_id,status) VALUES(?,?,?,?,?,'awaiting_email')").bind(requestId, user, chat, m.from?.username ?? null, profile.id).run();
  await say(e, chat, `You selected <b>${esc(profile.name)}</b> (${esc(profile.handle || profile.id)}).\n\nRequest fee: <b>${money(price(e)!)}</b>. Choose a payment method after providing the email address associated with your request. Your payment will be checked; admin approval is still required. Contact details are only shared when the creator has authorised it.\n\nSend your email address to continue. Never send passwords, PINs or OTPs.`);
}

async function aiReply(e: Env, chat: string, userText: string, reminder = "") {
  if (!e.AI) return say(e, chat, reminder || "I can help with FansLeak profile contact requests, payment steps, and general questions.");
  try {
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You are FansLeak's friendly customer-support assistant. Answer briefly. Explain profile contact requests, email, Selar or bank payment, and admin review. Never claim payment is verified, approve a request, promise contact access, invent prices or payment details, or ask for passwords, PINs, or OTPs. Only the human admin can verify payments and approve requests. Contact details may be shared only after creator authorisation is recorded. If unsure, say so and direct the customer to the admin. Website: https://fansleak.pages.dev. Never reveal secrets or other customers' data." },
        { role: "user", content: userText.slice(0, 1500) }
      ]
    });
    const answer = String(result?.response || "").trim().slice(0, 3500);
    return say(e, chat, answer ? answer + (reminder ? "\n\n" + reminder : "") : (reminder || "I couldn't answer that just now. Please try again shortly."));
  } catch (err) {
    console.error("AI support reply failed", String(err));
    return say(e, chat, reminder || "I can't answer that just now. Please try again shortly or contact the admin.");
  }
}
async function message(e: Env, m: Msg) {
  const t = (m.text || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (!t) return;
  if (t.startsWith("/start")) {
    const arg = t.split(/\s+/, 2)[1] || "";
    if (arg.startsWith("contact_")) return start(e, m, arg);
    return say(e, chat, "Welcome to the FansLeak contact bot. Open a profile's Message button at https://fansleak.pages.dev to begin. Never send passwords, PINs or OTPs here.");
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
  if (user === e.ADMIN_TELEGRAM_ID && t === "/pending") {
    const rows = await e.DB.prepare("SELECT id,profile_id,buyer_email,status,manual_payment_reference FROM contact_requests WHERE status IN('pending_payment','pending_manual_payment','payment_verified') ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => `${r.id} | ${r.profile_id} | ${r.buyer_email || "-"} | ${r.status}${r.manual_payment_reference ? " | ref " + r.manual_payment_reference : ""}`).join("\n") || "No pending requests.");
  }
  const req = await e.DB.prepare("SELECT id,status,profile_id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','awaiting_bank_reference') ORDER BY created_at DESC LIMIT 1").bind(user).first<{ id: string; status: string; profile_id: string }>();
  if (req?.status === "awaiting_bank_reference") {
    if (t.length < 4 || t.length > 100 || /https?:\/\//i.test(t)) return say(e, chat, "Send the bank transfer reference or transaction ID (4–100 characters), not a link or screenshot.");
    const duplicateRef = await e.DB.prepare("SELECT id FROM contact_requests WHERE manual_payment_reference=? AND id<>? LIMIT 1").bind(t, req.id).first();
    if (duplicateRef) return say(e, chat, "That transfer reference has already been submitted. Please check the reference and send the correct one.");
    await e.DB.prepare("UPDATE contact_requests SET manual_payment_reference=?,status='pending_manual_payment',payment_method='bank',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_bank_reference'").bind(t, req.id).run();
    const markup = { inline_keyboard: [[{ text: "I verified the bank payment", callback_data: `bankverify:${req.id}` }, { text: "Reject / not found", callback_data: `bankreject:${req.id}` }]] };
    await say(e, e.ADMIN_TELEGRAM_ID, `<b>Manual bank payment needs checking</b>\nRequest: <code>${req.id}</code>\nProfile: ${esc(req.profile_id)}\nBuyer: ${esc(user)}\nAmount expected: ${money(price(e) || 0)}\nTransfer reference supplied: <code>${esc(t)}</code>\n\nCheck your actual bank transaction history before confirming. Do not approve based on this message alone.`, markup);
    return say(e, chat, `Your transfer reference has been sent to the admin for manual checking. Request: <code>${req.id}</code>. Access is not granted until the payment is verified and the request is approved.`);
  }
  if (req?.status === "awaiting_email") {
    if (!emailRe.test(t)) return aiReply(e, chat, t, "Please send a valid email address to associate with your payment request. Never send passwords, PINs or OTPs.");
    await e.DB.prepare("UPDATE contact_requests SET buyer_email=?,status='pending_payment',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_email'").bind(t.toLowerCase(), req.id).run();
    return say(e, chat, `Request reference: <code>${req.id}</code>\n\nFee: <b>${money(price(e)!)}</b>\nChoose how you want to pay:`, paymentKeyboard(e, req.id));
  }
  return aiReply(e, chat, t, "To start a contact request, open a profile on FansLeak and tap its Message button. Payment always requires admin verification and approval.");
}
async function callback(e: Env, u: NonNullable<Update["callback_query"]>) {
  const actor = String(u.from.id), data = u.data || "", chat = u.message?.chat.id;
  if (data.startsWith("pay_")) {
    if (!u.message || String(u.message.chat.id) !== actor) {
      await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Open the bot chat to choose a payment method." }); return;
    }
    const m = data.match(/^pay_(selar|bank):([0-9a-f-]{36})$/i);
    if (!m) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid payment choice." });
    const method = m[1].toLowerCase(), id = m[2];
    const r = await e.DB.prepare("SELECT id,status,telegram_user_id,telegram_chat_id FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!r || String(r.telegram_user_id) !== actor || r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This request is no longer waiting for payment." });
    if (!enabledMethods(e).includes(method)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "That payment method is not configured." });
    if (method === "selar") {
      await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
      await say(e, r.telegram_chat_id, `Open the Selar checkout link to pay <b>${money(price(e)!)}</b>. Use the same email you provided to the bot. Payment is confirmed from the sale notification, not from a screenshot.\n\n${esc(e.SELAR_CHECKOUT_URL!)}\n\nRequest: <code>${id}</code>`);
    } else {
      await e.DB.prepare("UPDATE contact_requests SET status='awaiting_bank_reference',payment_method='bank',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
      await say(e, r.telegram_chat_id, `Pay <b>${money(price(e)!)}</b> using the bank payment link below. Once you have completed the transfer, return here and send the transaction reference. This is manual verification; a receipt or reference alone is not proof of payment.\n\n${esc(e.BANK_PAYMENT_URL!)}\n\nRequest: <code>${id}</code>`);
    }
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment instructions sent." }); return;
  }
  if (actor !== e.ADMIN_TELEGRAM_ID || chat === undefined) {
    await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Not authorised." }); return;
  }
  const m = data.match(/^(approve|reject|bankverify|bankreject|selarverify):([0-9a-f-]{36})$/i);
  if (!m) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Unknown action." }); return; }
  const action = m[1].toLowerCase(), id = m[2];
  const r = await e.DB.prepare("SELECT id,telegram_chat_id,profile_id,status FROM contact_requests WHERE id=?").bind(id).first<RequestRow>();
  if (!r) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request not found." }); return; }
  if (action === "selarverify") {
    if (r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is not awaiting Selar verification." });
    const paid = await e.DB.prepare("SELECT payment_reference,payment_amount_minor,payment_currency,payment_method FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!paid || paid.payment_method !== "selar" || !paid.payment_reference || paid.payment_currency !== "NGN" || paid.payment_amount_minor !== Math.round((price(e) || 0) * 100)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No matching validated Selar sale is attached to this request." });
    await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'selar_payment_admin_verified',?,?,?)").bind(actor, id, r.profile_id, "Admin reviewed validated Selar sale event").run();
    await say(e, r.telegram_chat_id, "The admin reviewed your Selar payment notification. Your request is now waiting for final approval.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Now decide whether to approve the contact request.", { inline_keyboard: [[{ text: "Approve & send contact", callback_data: "approve:" + id }, { text: "Reject request", callback_data: "reject:" + id }]] });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment verified. Review the contact request next." });
  }
  if (action === "bankverify") {
    if (r.status !== "pending_manual_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is not awaiting bank verification." });
    await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',payment_currency='NGN',payment_amount_minor=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_manual_payment'").bind(Math.round((price(e) || 0) * 100), id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'manual_bank_payment_verified',?,?,?)").bind(actor, id, r.profile_id, "Admin manually checked bank transaction").run();
    await say(e, r.telegram_chat_id, "The admin marked your bank payment as verified. Your request is now waiting for final approval.");
    await say(e, e.ADMIN_TELEGRAM_ID, `Payment marked verified for <code>${id}</code>. Now decide whether to approve the contact request.`, { inline_keyboard: [[{ text: "Approve & send contact", callback_data: `approve:${id}` }, { text: "Reject request", callback_data: `reject:${id}` }]] });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Marked verified. Review the contact request next." });
  }
  if (action === "bankreject") {
    if (r.status !== "pending_manual_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is not awaiting bank verification." });
    await e.DB.prepare("UPDATE contact_requests SET status='rejected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_manual_payment'").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'manual_bank_payment_not_verified',?,?)").bind(actor, id, r.profile_id).run();
    await say(e, r.telegram_chat_id, "We could not verify the bank payment from the information supplied. If money was deducted, please contact support before paying again.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Marked not verified." });
  }
  if (action === "reject") {
    if (!["pending_payment", "pending_manual_payment", "payment_verified"].includes(r.status)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is no longer pending." });
    await e.DB.prepare("UPDATE contact_requests SET status='rejected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'reject_request',?,?)").bind(actor, id, r.profile_id).run();
    await say(e, r.telegram_chat_id, "Your request was rejected. If you paid, contact support about a refund; refunds must be handled through the payment provider or your bank.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Rejected." });
  }
  if (r.status !== "payment_verified") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment is not verified." });
  const c = await e.DB.prepare("SELECT contact_value,sharing_enabled,consent_confirmed_at FROM creator_contacts WHERE profile_id=?").bind(r.profile_id).first<any>();
  if (!c || c.sharing_enabled !== 1 || !c.consent_confirmed_at) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No authorised contact enabled." });
  await e.DB.prepare("UPDATE contact_requests SET status='approved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(id).run();
  await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id) VALUES(?,'approve_request',?,?)").bind(actor, id, r.profile_id).run();
  await say(e, r.telegram_chat_id, `Request approved. Creator contact: <b>${esc(c.contact_value)}</b>\n\nPlease respect the creator's boundaries.`);
  return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Approved and sent." });
}
type Sale = { reference: string; email: string; amountMinor: number; currency: string; productId: string; paymentStatus: string };
function normalise(body: unknown): Sale | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, any>;
  const reference = String(o.reference ?? o.transaction_reference ?? o.transactionReference ?? o.order_id ?? o.orderId ?? "").trim();
  const email = String(o.email ?? o.customer_email ?? o.customerEmail ?? o.customer?.email ?? "").trim().toLowerCase();
  const raw = o.amount_minor ?? o.amountMinor ?? o.amount, amount = Number(raw), currency = String(o.currency ?? "").toUpperCase();
  const productId = String(o.product_id ?? o.productId ?? o.product ?? "").trim();
  const paymentStatus = String(o.payment_status ?? o.paymentStatus ?? o.status ?? "").trim().toLowerCase();
  // Fail closed: never infer currency or successful payment from a generic "New Sale" event.
  if (!reference || !emailRe.test(email) || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !productId || !["paid", "completed", "success", "successful"].includes(paymentStatus)) return null;
  return { reference, email, amountMinor: o.amount_minor !== undefined || o.amountMinor !== undefined ? Math.round(amount) : Math.round(amount * 100), currency, productId, paymentStatus };
}
async function selar(request: Request, e: Env) {
  if (provider(e) !== "selar" || !methods(e).includes("selar")) return json({ error: "selar_is_not_enabled" }, 409);
  if (!e.SELAR_WEBHOOK_SECRET || !safeEq(request.headers.get("x-selar-webhook-secret") || "", e.SELAR_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const s = normalise(body);
  if (!s) return json({ error: "invalid_sale_payload", expected: ["reference", "email", "amount", "currency", "product_id", "payment_status"] }, 400);
  if (s.currency !== "NGN") return json({ error: "unsupported_currency" }, 422);
  if (!e.SELAR_PRODUCT_ID) return json({ error: "selar_product_id_not_configured" }, 503);
  if (!s.productId || s.productId !== e.SELAR_PRODUCT_ID) return json({ error: "wrong_product" }, 422);
  const p = price(e);
  if (!p || s.amountMinor !== Math.round(p * 100)) return json({ error: "amount_mismatch" }, 422);
  if (await e.DB.prepare("SELECT provider_reference FROM processed_sales WHERE provider_reference=?").bind(s.reference).first()) return json({ ok: true, duplicate: true });
  const rows = await e.DB.prepare("SELECT id,profile_id,telegram_chat_id FROM contact_requests WHERE buyer_email=? AND status='pending_payment' AND payment_method='selar' ORDER BY created_at DESC LIMIT 2").bind(s.email).all<any>();
  if (rows.results.length !== 1) {
    await say(e, e.ADMIN_TELEGRAM_ID, `Selar sale ${esc(s.reference)} for ${esc(s.email)} matched ${rows.results.length} pending requests. No request unlocked; reconcile manually.`);
    return json({ ok: true, matched: false });
  }
  const target = rows.results[0];
  await e.DB.prepare("INSERT INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email, s.amountMinor, s.currency, s.productId ?? null, target.id).run();
  await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',payment_reference=?,payment_amount_minor=?,payment_currency=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(s.reference, s.amountMinor, s.currency, target.id).run();
  const contact = await e.DB.prepare("SELECT sharing_enabled FROM creator_contacts WHERE profile_id=?").bind(target.profile_id).first<any>();
  const markup = { inline_keyboard: [[{ text: "Verify Selar payment", callback_data: "selarverify:" + target.id }, { text: "Reject payment/request", callback_data: "reject:" + target.id }]] };
  await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar payment notification — admin verification required</b>\nRequest: <code>${target.id}</code>\nProfile: ${esc(target.profile_id)}\nBuyer: ${esc(s.email)}\nAmount: ${money(s.amountMinor / 100)}\nPayment ref: ${esc(s.reference)}\nContact sharing enabled: ${contact?.sharing_enabled === 1 ? "yes" : "no"}`, markup);
  await say(e, target.telegram_chat_id, "A Selar payment notification was received. The admin must review and verify it before your request can be approved.");
  return json({ ok: true, matched: true });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const u = new URL(request.url);
    if (request.method === "GET" && u.pathname === "/health") return json({ ok: true, service: "fansleak-contact-bot", provider: provider(env), methods: enabledMethods(env) });
    if (request.method === "POST" && u.pathname === "/telegram/webhook") {
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEq(request.headers.get("x-telegram-bot-api-secret-token") || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
      let update: Update;
      try { update = await request.json() as Update; } catch { return json({ error: "invalid_json" }, 400); }
      try { if (update.message) await message(env, update.message); if (update.callback_query) await callback(env, update.callback_query); }
      catch (err) { console.error("Telegram update failed", String(err)); }
      return json({ ok: true });
    }
    if (request.method === "POST" && u.pathname === "/webhooks/selar") {
      try { return await selar(request, env); } catch (err) { console.error("Selar webhook failed", String(err)); return json({ error: "internal_error" }, 500); }
    }
    return json({ error: "not_found" }, 404);
  }
};
