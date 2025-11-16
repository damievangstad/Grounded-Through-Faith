const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const STRIPE_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestPost({ request, env }) {
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const priceId = (env.STRIPE_PRICE_ID_MONTHLY || '').trim();

  if (!secretKey || !priceId) {
    return new Response(
      JSON.stringify({ error: 'Stripe environment variables are missing.' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (_) {
    payload = {};
  }

  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  const successUrl =
    typeof payload.successUrl === 'string' && payload.successUrl.trim()
      ? payload.successUrl.trim()
      : `${origin}/member-portal.html`;
  const cancelUrl =
    typeof payload.cancelUrl === 'string' && payload.cancelUrl.trim()
      ? payload.cancelUrl.trim()
      : `${origin}/membership.html`;

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('payment_method_types[0]', 'card');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');

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
      const detail = await upstream.text();
      return new Response(
        JSON.stringify({ error: 'Stripe checkout failed.', detail }),
        {
          status: upstream.status === 401 ? 401 : 502,
          headers: JSON_HEADERS,
        }
      );
    }

    const data = await upstream.json();
    if (!data.url) {
      return new Response(
        JSON.stringify({ error: 'Stripe response missing redirect URL.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Checkout error.' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
