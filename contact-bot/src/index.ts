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
  CONTACT_PRICE_NGN: string;
  SERVICE_PRICE_NGN?: string;
  SERVICE_CHECKOUT_URL?: string;
  SERVICE_PRODUCT_ID?: string;
  SERVICE_ORDER_FIELD_NAME?: string;
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
type Profile = { id: string; name: string; handle: string };
type RequestRow = { id: string; telegram_chat_id: string; profile_id: string; status: string; buyer_email?: string; manual_payment_reference?: string; checkout_code?: string; checkout_name?: string };
const checkoutCode = () => "FL-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
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
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
const price = (e: Env) => { const n = Number(e.CONTACT_PRICE_NGN); return Number.isFinite(n) && n > 0 ? n : null; };
const servicePrice = (e: Env) => { const n = Number(e.SERVICE_PRICE_NGN); return Number.isFinite(n) && n > 0 ? n : null; };
const money = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(n);
const currencyDigits = (currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
const saleMoney = (minor: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / (10 ** currencyDigits(currency)));
const provider = (e: Env) => (e.PAYMENT_PROVIDER || "selar").trim().toLowerCase();
const methods = (e: Env) => (e.PAYMENT_METHODS || "selar").split(",").map(x => x.trim().toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
function enabledMethods(e: Env) {
  const configured: string[] = [];
  if (methods(e).includes("selar") && provider(e) === "selar" && e.SELAR_CHECKOUT_URL && e.SELAR_PRODUCT_ID) configured.push("selar");
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
  const activeService = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (activeService) return say(e, chat, "You already have a service purchase in progress. Finish it or contact support before starting a contact request.");
  const active = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (active) return say(e, chat, "You already have a request in progress. Finish it or contact support before starting another.");
  const requestId = crypto.randomUUID(), code = checkoutCode();
  await e.DB.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,telegram_username,profile_id,status,checkout_code) VALUES(?,?,?,?,?,'awaiting_email',?)").bind(requestId, user, chat, m.from?.username ?? null, profile.id, code).run();
  await say(e, chat, `You selected <b>${esc(profile.name)}</b> (${esc(profile.handle || profile.id)}).\n\nRequest fee: <b>${money(price(e)!)}</b>. Choose a payment method after providing the email address associated with your request. Your payment will be checked; admin approval is still required. Contact details are only shared when the creator has authorised it.\n\nSend your email address to continue. Never send passwords, PINs or OTPs.`);
}

async function aiReply(e: Env, chat: string, userText: string, reminder = "") {
  if (!e.AI) return say(e, chat, reminder || "I can help with FansLeak profile contact requests, payment steps, and general questions.");
  try {
    const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You are FansLeak's friendly customer-support assistant. Answer briefly. Explain profile contact requests, email, Selar payment, and admin review. Never claim payment is verified, approve a request, promise contact access, invent prices or payment details, or ask for passwords, PINs, or OTPs. Only the human admin can verify payments and approve requests. Contact details may be shared only after creator authorisation is recorded. If unsure, say so and direct the customer to the admin. Website: https://fansleak.pages.dev. Never reveal secrets or other customers' data." },
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

async function startService(e: Env, m: Msg, serviceId: string) {
  const chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(serviceId)) return say(e, chat, "Invalid service purchase link.");
  if (!servicePrice(e) || !e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || !e.SERVICE_ORDER_FIELD_NAME?.trim() || provider(e) !== "selar") {
    await say(e, chat, "This service purchase is not accepting orders yet. Please try again later.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Service purchase setup required: configure SERVICE_PRICE_NGN, SERVICE_CHECKOUT_URL, SERVICE_PRODUCT_ID and SERVICE_ORDER_FIELD_NAME.");
    return;
  }
  const activeContact = await e.DB.prepare("SELECT id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (activeContact) return say(e, chat, "You already have a FansLeak contact request in progress. Finish it or contact support before starting a service purchase.");
  const active = await e.DB.prepare("SELECT id FROM service_orders WHERE telegram_user_id=? AND status IN('awaiting_request','awaiting_email','pending_payment','payment_verified') LIMIT 1").bind(user).first();
  if (active) return say(e, chat, "You already have a service order in progress. Finish it or contact support before starting another.");
  const id = crypto.randomUUID(), code = checkoutCode();
  await e.DB.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,checkout_code) VALUES(?,?,?,?,?,'awaiting_request',?)").bind(id, serviceId, user, chat, m.from?.username ?? null, code).run();
  return say(e, chat, "Hi! I’m the FansLeak AI assistant. Tell me what you need, and I’ll ask a few questions so I understand your request.\n\nOrder reference: <code>" + id + "</code>\n\nWhen you’re ready to purchase, type PAY. This Selar product has a fixed price of " + money(servicePrice(e)!) + ". No email is needed in this Telegram chat.");
}

async function message(e: Env, m: Msg) {
  const t = (m.text || "").trim(), chat = String(m.chat.id), user = String(m.from?.id ?? m.chat.id);
  if (!t) return;
  if (t.startsWith("/start")) {
    const arg = t.split(/\s+/, 2)[1] || "";
    if (arg.startsWith("contact_")) return start(e, m, arg);
    if (arg.startsWith("service_")) return startService(e, m, arg.slice("service_".length));
    return say(e, chat, "Open a FansLeak profile Message link for contact and assessment, or use the service purchase link you were given. Never send passwords, PINs or OTPs here.");
  }

  if (user === e.ADMIN_TELEGRAM_ID && t.startsWith("/deliver ")) {
    const match = t.match(/^\/deliver\s+([0-9a-f-]{36})\s+([\s\S]{1,3500})$/i);
    if (!match) return say(e, chat, "Usage: /deliver ORDER_ID service details or fulfilment text");
    const order = await e.DB.prepare("SELECT id,telegram_chat_id,status FROM service_orders WHERE id=?").bind(match[1]).first<any>();
    if (!order || order.status !== "payment_verified") return say(e, chat, "Order not found or payment has not been verified. Nothing was sent.");
    await tg(e, "sendMessage", { chat_id: order.telegram_chat_id, text: "Your service order is ready. Details from the provider:\n\n" + match[2], disable_web_page_preview: true });
    await e.DB.prepare("UPDATE service_orders SET status='fulfilled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='payment_verified'").bind(order.id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_order_fulfilled',?,?)").bind(user, order.id, "Admin sent service fulfilment").run();
    return say(e, chat, "Fulfilment sent to customer for order " + order.id);
  }
  if (user === e.ADMIN_TELEGRAM_ID && t === "/orders") {
    const rows = await e.DB.prepare("SELECT id,service_id,telegram_username,telegram_user_id,status,CASE WHEN status='payment_verified' THEN substr(request_text,-180) ELSE 'Request hidden until payment is verified' END AS visible_request FROM service_orders WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => r.id + " | " + r.service_id + " | @" + (r.telegram_username || "unknown") + " | Telegram " + r.telegram_user_id + " | " + r.status + " | " + String(r.visible_request || "")).join("\n") || "No service orders awaiting payment or fulfilment.");
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
    const rows = await e.DB.prepare("SELECT id,profile_id,buyer_email,status FROM contact_requests WHERE status IN('pending_payment','payment_verified') ORDER BY created_at DESC LIMIT 20").all<any>();
    return say(e, chat, (rows.results || []).map(r => `${r.id} | ${r.profile_id} | ${r.buyer_email || "-"} | ${r.status}`).join("\n") || "No pending requests.");
  }

  const serviceOrder = await e.DB.prepare("SELECT id,status,request_text,checkout_code FROM service_orders WHERE telegram_user_id=? AND status='awaiting_request' ORDER BY created_at DESC LIMIT 1").bind(user).first<any>();
  if (serviceOrder) {
    if (/^\/?(pay|checkout|ready to pay)$/i.test(t)) {
      const requestText = String(serviceOrder.request_text || "").trim();
      if (requestText.length < 3) return say(e, chat, "First, tell me what you need so I can understand your request.");
      if (!servicePrice(e) || !e.SERVICE_CHECKOUT_URL || !e.SERVICE_PRODUCT_ID || !e.SERVICE_ORDER_FIELD_NAME?.trim() || provider(e) !== "selar") return say(e, chat, "The service checkout is not configured yet. Please try again later.");
      await e.DB.prepare("UPDATE service_orders SET status='pending_payment',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(serviceOrder.id).run();
      const checkout = new URL(e.SERVICE_CHECKOUT_URL);
      checkout.searchParams.set("add_to_cart", "1");
      return say(e, chat, "Open the Selar checkout below. In the name field, enter your full name followed by this code exactly: <code>" + esc(serviceOrder.checkout_code) + "</code>. Example: <code>Joseph Unaogu " + esc(serviceOrder.checkout_code) + "</code>. No email is needed in this Telegram chat; Selar may still request its standard checkout details.\n\n" + esc(checkout.toString()) + "\n\nAfter checkout, tap Done below. The admin—not the bot—checks payment manually.", { inline_keyboard: [[{ text: "Done", callback_data: "done:" + serviceOrder.id }]] });
    }
    if (t.length < 2 || t.length > 2000) return say(e, chat, "Please send a message between 2 and 2,000 characters.");
    const previous = String(serviceOrder.request_text || "");
    const updated = (previous + (previous ? "\nCustomer: " : "Customer: ") + t).slice(-8000);
    await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(updated, serviceOrder.id).run();
    if (!e.AI) return say(e, chat, "Thanks. Tell me a little more about what you need, or type PAY when you’re ready to purchase at " + money(servicePrice(e)!) + ".");
    try {
      const result = await e.AI.run(e.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: "You are the FansLeak AI service assistant. Talk naturally and briefly with the customer to understand their service request. Ask one useful clarifying question at a time if needed. Do not ask for email, phone, passwords, PINs, OTPs, or sensitive payment information. Do not invent prices or promise that a service can be delivered. This Selar product has one fixed configured price; tell the customer they can type PAY when ready to purchase, and the bot will show the checkout. Never claim payment is complete. If the customer asks how much, say the fixed checkout price is " + money(servicePrice(e) || 0) + ". The order reference is " + serviceOrder.id + ". The conversation so far: " + updated.slice(-6000) },
          { role: "user", content: t.slice(0, 1500) }
        ]
      });
      const answer = String(result?.response || "").trim().slice(0, 2500);
      if (answer) {
        const transcript = (updated + "\nAssistant: " + answer).slice(-8000);
        await e.DB.prepare("UPDATE service_orders SET request_text=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_request'").bind(transcript, serviceOrder.id).run();
      }
      return say(e, chat, answer || "Thanks. Tell me a little more about what you need, or type PAY when you’re ready to purchase at " + money(servicePrice(e)!) + ".");
    } catch (err) {
      console.error("AI service conversation failed", String(err));
      return say(e, chat, "I saved your message. You can tell me more, or type PAY when you’re ready to purchase at " + money(servicePrice(e)!) + ".");
    }
  }
  const prompt = await e.DB.prepare("SELECT order_id,order_kind FROM checkout_name_prompts WHERE telegram_user_id=?").bind(user).first<any>();
  if (prompt) {
    const code = codeInName(t);
    if (!code) return say(e, chat, "I couldn't find the order code. Please send your exact full name followed by the code shown in checkout, for example: Joseph Unaogu FL-7K4P9.");
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
  const req = await e.DB.prepare("SELECT id,status,profile_id FROM contact_requests WHERE telegram_user_id=? AND status IN('awaiting_email') ORDER BY created_at DESC LIMIT 1").bind(user).first<{ id: string; status: string; profile_id: string }>();
  if (req?.status === "awaiting_email") {
    if (!emailRe.test(t)) return aiReply(e, chat, t, "Please send a valid email address to associate with your payment request. Never send passwords, PINs or OTPs.");
    await e.DB.prepare("UPDATE contact_requests SET buyer_email=?,status='pending_payment',payment_method='selar',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='awaiting_email'").bind(t.toLowerCase(), req.id).run();
    const order = await e.DB.prepare("SELECT checkout_code FROM contact_requests WHERE id=?").bind(req.id).first<any>();
    return say(e, chat, `Open the Selar checkout. In the name field, enter your full name followed by this code exactly: <code>${esc(order?.checkout_code || "")}</code>. Example: <code>Joseph Unaogu ${esc(order?.checkout_code || "")}</code>. Use the same email you provided to the bot.\n\n${esc(e.SELAR_CHECKOUT_URL || "")}`, { inline_keyboard: [[{ text: "Done", callback_data: "done:" + req.id }]] });
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
    if (!order || String(order.telegram_user_id) !== actor || order.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This order is not waiting for checkout confirmation." });
    if (order.checkout_name) return say(e, actor, "Your checkout name and code have already been matched. Payment still needs to be checked manually.");
    const kind = contact ? "contact" : "service";
    await e.DB.prepare("INSERT OR REPLACE INTO checkout_name_prompts(telegram_user_id,order_id,order_kind) VALUES(?,?,?)").bind(actor, id, kind).run();
    await say(e, actor, "Please send the exact full name you used in Selar's name field, including the code. Example: <code>Joseph Unaogu " + esc(order.checkout_code) + "</code>. This does not confirm payment.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Send your checkout name and code." });
  }
  if (data.startsWith("pay_")) {
    if (!u.message || String(u.message.chat.id) !== actor) {
      await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Open the bot chat to choose a payment method." }); return;
    }
    const m = data.match(/^pay_selar:([0-9a-f-]{36})$/i);
    if (!m) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Invalid payment choice." });
    const method = "selar", id = m[1];
    const r = await e.DB.prepare("SELECT id,status,telegram_user_id,telegram_chat_id FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!r || String(r.telegram_user_id) !== actor || r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "This request is no longer waiting for payment." });
    if (!enabledMethods(e).includes(method)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "That payment method is not configured." });
    if (method === "selar") {
      await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
      await say(e, r.telegram_chat_id, `Open the Selar checkout link to pay <b>${money(price(e)!)}</b>. Use the same email you provided to the bot. Payment is confirmed from the sale notification, not from a screenshot.\n\n${esc(e.SELAR_CHECKOUT_URL!)}\n\nRequest: <code>${id}</code>`);
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
    if (!service || service.status !== "pending_payment" || service.payment_method !== "selar" || !service.payment_reference) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No sale notification is attached to this pending service order." });
    await e.DB.prepare("UPDATE service_orders SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,details) VALUES(?,'service_payment_admin_verified',?,'Admin manually confirmed Selar payment')").bind(actor, id).run();
    await say(e, service.telegram_chat_id, "The admin has manually confirmed your payment. Your service order is awaiting fulfilment.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Payment manually confirmed for service order <code>" + id + "</code>. Use /deliver " + id + " your service details when ready.");
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment confirmed by your admin action." });
  }
  const r = await e.DB.prepare("SELECT id,telegram_chat_id,profile_id,status FROM contact_requests WHERE id=?").bind(id).first<RequestRow>();
  if (!r) { await tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request not found." }); return; }
  if (action === "selarverify") {
    if (r.status !== "pending_payment") return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is not awaiting Selar verification." });
    const paid = await e.DB.prepare("SELECT payment_reference,payment_method FROM contact_requests WHERE id=?").bind(id).first<any>();
    if (!paid || paid.payment_method !== "selar" || !paid.payment_reference) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "No Selar sale notification is attached. Check Selar before confirming." });
    await e.DB.prepare("UPDATE contact_requests SET status='payment_verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(id).run();
    await e.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details) VALUES(?,'selar_payment_admin_verified',?,?,?)").bind(actor, id, r.profile_id, "Admin reviewed validated Selar sale event").run();
    await say(e, r.telegram_chat_id, "The admin reviewed your Selar payment notification. Your request is now waiting for final approval.");
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar payment verified by admin for <code>" + id + "</code>. Now decide whether to approve the contact request.", { inline_keyboard: [[{ text: "Approve & send contact", callback_data: "approve:" + id }, { text: "Reject request", callback_data: "reject:" + id }]] });
    return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Payment verified. Review the contact request next." });
  }
  if (action === "reject") {
    if (!["pending_payment", "payment_verified"].includes(r.status)) return tg(e, "answerCallbackQuery", { callback_query_id: u.id, text: "Request is no longer pending." });
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
type Sale = { reference: string; email: string; customerName: string; productId: string };
function normalise(body: unknown): Sale | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, any>;
  const reference = String(o.reference ?? o.transaction_reference ?? o.transactionReference ?? o.sale_reference ?? o.saleReference ?? "").trim();
  const email = String(o.email ?? o.customer_email ?? o.customerEmail ?? o.customer?.email ?? "").trim().toLowerCase();
  const customerName = String(o.customer_full_name ?? o.customer_name ?? o.full_name ?? o.fullName ?? o.name ?? o.customer?.name ?? "").trim();
  const productId = String(o.product_code ?? o.productCode ?? o.product_id ?? o.productId ?? o.product ?? "").trim();
  // Sale events notify the admin only. Amount, currency and payment status never verify payment.
  if (!reference || !customerName || !productId) return null;
  return { reference, email, customerName, productId };
}
async function selar(request: Request, e: Env) {
  if (provider(e) !== "selar" || !methods(e).includes("selar")) return json({ error: "selar_is_not_enabled" }, 409);
  if (!e.SELAR_WEBHOOK_SECRET || !safeEq(request.headers.get("x-selar-webhook-secret") || "", e.SELAR_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const s = normalise(body);
  if (!s) return json({ error: "invalid_sale_payload", expected: ["reference", "customer_full_name", "product_code"] }, 400);
  const kind: "contact" | "service" | null = s.productId === e.SELAR_PRODUCT_ID ? "contact" : s.productId === e.SERVICE_PRODUCT_ID ? "service" : null;
  if (!kind) return json({ error: "wrong_product" }, 422);
  const code = codeInName(s.customerName);
  if (!code) return json({ error: "sale_name_missing_order_code" }, 422);
  if (await e.DB.prepare("SELECT provider_reference FROM processed_sales WHERE provider_reference=?").bind(s.reference).first()) return json({ ok: true, duplicate: true });
  const rows = kind === "contact"
    ? await e.DB.prepare("SELECT id,profile_id,telegram_chat_id,checkout_code,checkout_name FROM contact_requests WHERE checkout_code=? AND status='pending_payment' AND payment_method='selar' LIMIT 2").bind(code).all<any>()
    : await e.DB.prepare("SELECT id,service_id AS profile_id,telegram_chat_id,request_text,telegram_username,telegram_user_id,checkout_code,checkout_name FROM service_orders WHERE checkout_code=? AND status='pending_payment' LIMIT 2").bind(code).all<any>();
  if (rows.results.length !== 1) {
    await say(e, e.ADMIN_TELEGRAM_ID, `Selar sale ${esc(s.reference)} with checkout code ${esc(code)} matched ${rows.results.length} pending orders. No payment status changed; reconcile manually.`);
    return json({ ok: true, matched: false });
  }
  const target = rows.results[0];
  const saleName = s.customerName.replace(new RegExp("\\s*" + code + "\\s*$", "i"), "").trim();
  if (target.checkout_name && normName(target.checkout_name) !== normName(saleName)) {
    await say(e, e.ADMIN_TELEGRAM_ID, "Selar sale " + esc(s.reference) + " includes code " + esc(code) + " but the name differs from the name submitted by the customer. Please check manually; no payment status changed.");
    return json({ ok: true, matched: false, reason: "name_mismatch" });
  }
  await e.DB.prepare("INSERT INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id) VALUES(?,?,?,?,?,?)").bind(s.reference, s.email || "", 0, "UNK", s.productId, target.id).run();
  if (kind === "contact") {
    await e.DB.prepare("UPDATE contact_requests SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND payment_method='selar'").bind(s.reference, target.id).run();
    const contact = await e.DB.prepare("SELECT sharing_enabled FROM creator_contacts WHERE profile_id=?").bind(target.profile_id).first<any>();
  const markup = { inline_keyboard: [[{ text: "Confirm payment manually", callback_data: "selarverify:" + target.id }, { text: "Reject request", callback_data: "reject:" + target.id }]] };
  await say(e, e.ADMIN_TELEGRAM_ID, `<b>Selar sale received — please check manually</b>\nRequest: <code>${target.id}</code>\nProfile: ${esc(target.profile_id)}\nCustomer name: ${esc(s.customerName)}\nPayment reference: ${esc(s.reference)}\nContact sharing enabled: ${contact?.sharing_enabled === 1 ? "yes" : "no"}`, markup);
    await say(e, target.telegram_chat_id, "A Selar payment notification was received. The admin must review and verify it before your request can be approved.");
  } else {
    await e.DB.prepare("UPDATE service_orders SET payment_method='selar',payment_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment'").bind(s.reference, target.id).run();
    await say(e, e.ADMIN_TELEGRAM_ID, "<b>Selar sale received — please check manually</b>\nOrder: <code>" + target.id + "</code>\nService: " + esc(target.profile_id) + "\nCustomer name: " + esc(s.customerName) + "\nPayment reference: " + esc(s.reference) + "\nCustomer request/conversation: " + esc(String(target.request_text || "Not provided").slice(-1800)) + "\n\nConfirm only after checking Selar manually.", { inline_keyboard: [[{ text: "Confirm payment manually", callback_data: "serviceverify:" + target.id }]] });
  }
  return json({ ok: true, matched: true });
}

async function abandonedCart(request: Request, e: Env) {
  if (provider(e) !== "selar" || !methods(e).includes("selar")) return json({ error: "selar_is_not_enabled" }, 409);
  if (!e.SELAR_WEBHOOK_SECRET || !safeEq(request.headers.get("x-selar-webhook-secret") || "", e.SELAR_WEBHOOK_SECRET)) return json({ error: "unauthorised" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "invalid_cart_payload" }, 400);
  const o = body as Record<string, any>;
  const customerName = String(o.customer_full_name ?? o.customer_name ?? o.full_name ?? o.fullName ?? o.name ?? o.customer?.name ?? "").trim();
  const productCode = String(o.product_code ?? o.productCode ?? o.all_product_codes ?? "").split(",")[0].trim();
  const abandonedAt = String(o.abandoned_at ?? o.abandonedAt ?? "").trim();
  // This optional identifier is useful only if a trusted source actually includes it in the cart event.
  // Selar's current Abandoned Cart sample does not include it, so never synthesize or infer it.
  const fansOrderId = String(o.fans_order_id ?? o.fansOrderId ?? o.order_id ?? "").trim();
  if (!customerName || !productCode || !abandonedAt || !Number.isFinite(Date.parse(abandonedAt))) {
    return json({ error: "invalid_cart_payload", expected: ["customer_name", "product_code", "abandoned_at"] }, 400);
  }
  // Only route events for a configured product. Do not guess a Telegram chat from email alone.
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
    await say(e, target.telegram_chat_id, "It looks like your Selar checkout was not completed. If you already paid, please contact support and we will check it manually. The bot does not confirm payments." + extra + "\n\n" + esc(checkout), { inline_keyboard: [[{ text: "Done", callback_data: "done:" + target.id }]] });
  } catch (err) {
    // Let a provider retry if Telegram rejected the send; don't permanently consume the event.
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
      try { update = await request.json() as Update; } catch { return json({ error: "invalid_json" }, 400); }
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
