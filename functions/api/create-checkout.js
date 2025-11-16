const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestPost({ env }) {
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const priceId = (env.STRIPE_PRICE_ID_MONTHLY || '').trim();

  if (!secretKey || !priceId) {
    return new Response(JSON.stringify({ error: 'Stripe is not configured.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  const successUrl = env.MEMBERSHIP_SUCCESS_URL || 'https://www.groundedthroughfaith.org/member-portal.html';
  const cancelUrl = env.MEMBERSHIP_CANCEL_URL || 'https://www.groundedthroughfaith.org/membership.html#join';

  const body = new URLSearchParams({
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  body.append('line_items[0][price]', priceId);
  body.append('line_items[0][quantity]', '1');

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();
    if (!response.ok || !data?.url) {
      const message = data?.error?.message || 'Unable to start checkout.';
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: DEFAULT_HEADERS,
      });
    }

    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: DEFAULT_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Checkout failed.' }), {
      status: 500,
      headers: DEFAULT_HEADERS,
    });
  }
}
