const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const STRIPE_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';
const SUCCESS_FALLBACK = 'https://www.groundedthroughfaith.org/membership.html#signin';
const CANCEL_FALLBACK = 'https://www.groundedthroughfaith.org/membership.html';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export async function onRequestPost({ request, env }) {
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const priceId = (env.Membership || '').trim();

  if (!secretKey) {
    return new Response(JSON.stringify({ error: 'Stripe secret is not configured.' }), {
      status: 500,
      headers: BASE_HEADERS,
    });
  }

  if (!priceId) {
    return new Response(JSON.stringify({ error: 'Membership price ID is missing.' }), {
      status: 500,
      headers: BASE_HEADERS,
    });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const successUrl = typeof body.successUrl === 'string' && body.successUrl.trim() ? body.successUrl.trim() : SUCCESS_FALLBACK;
  const cancelUrl = typeof body.cancelUrl === 'string' && body.cancelUrl.trim() ? body.cancelUrl.trim() : CANCEL_FALLBACK;

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('payment_method_types[0]', 'card');

  try {
    const upstream = await fetch(STRIPE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new Response(JSON.stringify({ error: 'Stripe checkout failed.', detail: text }), {
        status: upstream.status === 401 ? 401 : 502,
        headers: BASE_HEADERS,
      });
    }

    const data = await upstream.json();
    if (!data.url) {
      return new Response(JSON.stringify({ error: 'Stripe response missing redirect URL.' }), {
        status: 502,
        headers: BASE_HEADERS,
      });
    }

    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: BASE_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Checkout error.' }), {
      status: 500,
      headers: BASE_HEADERS,
    });
  }
}
