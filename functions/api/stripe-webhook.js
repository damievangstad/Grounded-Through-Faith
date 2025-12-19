// Core headers keep webhook responses consistent and Stripe-friendly.
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

// Default sender used when no custom email configuration is supplied.
const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';

// Known accounts remain from the previous implementation but no longer receive
// automatically created logins. Users are expected to register first, then
// subscribe, and we simply flip their subscriber flag after payment.
const DEFAULT_KNOWN_EMAILS = ['themissioneffect@gmail.com', 'groundedthroughfaith@gmail.com'];

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSalt() {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  return toHex(saltBytes.buffer);
}

async function hashSecret(secret, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

// Resolve a D1 binding for membership creation, even if the environment uses a
// different key. Known names are preferred, but we also scan for any binding
// exposing the D1 `prepare` API to avoid failing after successful Stripe
// payments.
function requireDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function') {
      return value;
    }
  }

  throw new Response(JSON.stringify({ message: 'Account database unavailable.' }), {
    status: 503,
    headers: HEADERS,
  });
}

async function ensureSchema(db) {
  // Create the Users table if missing so Stripe webhooks can flip subscription
  // flags on already-registered members instead of creating surprise accounts.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS Users (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Email TEXT NOT NULL UNIQUE,
        PasswordHash TEXT NOT NULL,
        PasswordSalt TEXT NOT NULL,
        TemporaryCodeHash TEXT,
        TemporaryCodeSalt TEXT,
        TemporaryCodeExpiresAt TEXT,
        NeedsPassword INTEGER NOT NULL DEFAULT 0,
        IsSubscriber INTEGER NOT NULL DEFAULT 0,
        SubscriberSince TEXT,
        CreatedAt TEXT NOT NULL
      );`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS KnownAccounts (
        Email TEXT PRIMARY KEY,
        RecordedAt TEXT NOT NULL,
        LastSeenAt TEXT NOT NULL
      );`
    )
    .run();

  const columns = await db.prepare("PRAGMA table_info('Users');").all();
  const columnNames = new Set((columns?.results || columns || []).map((c) => c?.name));

  async function ensureColumn(name, definition) {
    if (!columnNames.has(name)) {
      await db.prepare(`ALTER TABLE Users ADD COLUMN ${name} ${definition};`).run();
    }
  }

  await ensureColumn('TemporaryCodeHash', 'TEXT');
  await ensureColumn('TemporaryCodeSalt', 'TEXT');
  await ensureColumn('TemporaryCodeExpiresAt', 'TEXT');
  await ensureColumn('NeedsPassword', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('IsSubscriber', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('SubscriberSince', 'TEXT');
}

async function trackKnownAccount(db, email) {
  if (!email) return;
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO KnownAccounts (Email, RecordedAt, LastSeenAt)
       VALUES (?, ?, ?)
       ON CONFLICT(Email) DO UPDATE SET LastSeenAt = excluded.LastSeenAt`
    )
    .bind(email, timestamp, timestamp)
    .run();
}

async function seedKnownAccounts(db) {
  for (const email of DEFAULT_KNOWN_EMAILS) {
    await trackKnownAccount(db, email);
  }
}

async function updateSubscription(db, email) {
  // Match the paying customer to an existing login and flip their subscriber
  // flags. If the account is missing we avoid creating it automatically and
  // simply return a hint so support can reach out.
  const user = await db
    .prepare('SELECT Email, IsSubscriber, SubscriberSince FROM Users WHERE Email = ?')
    .bind(email)
    .first();

  if (!user || !user.Email) {
    await trackKnownAccount(db, email);
    return { updated: false, missingAccount: true };
  }

  const alreadySubscriber = user.IsSubscriber === 1 || user.IsSubscriber === '1';
  const subscriberSince = user.SubscriberSince || new Date().toISOString();

  await db
    .prepare('UPDATE Users SET IsSubscriber = 1, SubscriberSince = ? WHERE Email = ?')
    .bind(subscriberSince, email)
    .run();

  await trackKnownAccount(db, email);
  return { updated: true, alreadySubscriber };
}

function resolveSender(env) {
  const configured = (env?.RESEND_FROM || '').trim();
  return configured || DEFAULT_SENDER;
}

async function sendEmail(env, to, { missingAccount } = {}) {
  // Payment confirmation email gently reminds the member to sign in with the
  // password they created during registration; no temporary codes are issued.
  const subject = 'Thank you for subscribing to Grounded Through Faith';
  const text = missingAccount
    ? `We received your subscription. Please finish creating your account at https://www.groundedthroughfaith.org/signin.html by registering with this email before signing in. If you ever need help, email groundedthroughfaith@gmail.com.`
    : `Your subscription is active. Sign in at https://www.groundedthroughfaith.org/signin.html with the email and password you created. If you ever need help, email groundedthroughfaith@gmail.com.`;
  const html = missingAccount
    ? `<p>We received your subscription.</p><p>Please finish creating your account at <a href="https://www.groundedthroughfaith.org/signin.html">groundedthroughfaith.org/signin.html</a> by registering with this email before signing in.</p><p>If you ever need help, email <a href="mailto:groundedthroughfaith@gmail.com">groundedthroughfaith@gmail.com</a>.</p>`
    : `<p>Your subscription is active.</p><p>Sign in at <a href="https://www.groundedthroughfaith.org/signin.html">groundedthroughfaith.org/signin.html</a> with the email and password you created.</p><p>If you ever need help, email <a href="mailto:groundedthroughfaith@gmail.com">groundedthroughfaith@gmail.com</a>.</p>`;

  const resendKey = (env?.RESEND_KEY || '').trim();
  const sender = resolveSender(env);
  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: sender, to: Array.isArray(to) ? to : [to], subject, text, html }),
    });

    if (!response.ok) {
      const message = await response.text();
      return { sent: false, reason: message || 'Resend request failed' };
    }

    const json = await response.json().catch(() => ({}));
    return { sent: true, id: json?.id || null, provider: 'resend' };
  }

  const webhook = (env?.EMAIL_WEBHOOK_URL || '').trim();
  if (webhook) {
    const token = (env?.EMAIL_WEBHOOK_TOKEN || '').trim();
    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
        body: JSON.stringify({ to, subject, text, html, from: sender }),
      });

    if (!response.ok) {
      const message = await response.text();
      return { sent: false, reason: message || 'Email request failed' };
    }

    return { sent: true, provider: 'webhook' };
  }

  return { sent: false, reason: 'Email delivery not configured' };
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestPost({ env, request }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), { status: 400, headers: HEADERS });
  }

  const eventType = payload?.type;
  const session = payload?.data?.object || {};
  const customerEmail = normalizeEmail(session.customer_details?.email || session.customer_email);

  if (!eventType) {
    return new Response(JSON.stringify({ message: 'Event type missing' }), { status: 400, headers: HEADERS });
  }

  if (eventType !== 'checkout.session.completed' && eventType !== 'invoice.payment_succeeded') {
    return new Response(JSON.stringify({ received: true, ignored: true }), { status: 200, headers: HEADERS });
  }

  if (!customerEmail) {
    return new Response(JSON.stringify({ message: 'Customer email missing' }), { status: 200, headers: HEADERS });
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
    await seedKnownAccounts(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  const result = await updateSubscription(db, customerEmail);
  const emailStatus = await sendEmail(env, customerEmail, { missingAccount: result.missingAccount });

  const responseBody = {
    updated: result.updated,
    alreadySubscriber: result.alreadySubscriber || false,
    missingAccount: result.missingAccount || false,
    email: customerEmail,
    emailDelivered: emailStatus.sent || false,
    emailError: emailStatus.sent ? null : emailStatus.reason || null,
  };

  // We return 200 regardless to avoid Stripe retries, but the body reveals
  // whether the account was missing so support can reconcile it manually.
  return new Response(JSON.stringify(responseBody), { status: 200, headers: HEADERS });
}
