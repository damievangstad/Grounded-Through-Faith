const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestPost({ env }) {
  try {
    const secretKey = env.STRIPE_SECRET_KEY;
    const priceId = env.STRIPE_PRICE_ID_MONTHLY;

    if (!secretKey || !priceId) {
      return new Response(
        JSON.stringify({ url: null, error: 'Missing Stripe config' }),
        { status: 500, headers: HEADERS }
      );
    }

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append(
      'success_url',
      'https://groundedthroughfaith.org/membership?status=success'
    );
    params.append(
      'cancel_url',
      'https://groundedthroughfaith.org/membership?status=cancelled'
    );
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe error:', data);
      return new Response(
        JSON.stringify({
          url: null,
          error: data.error?.message || 'Stripe error',
        }),
        { status: 500, headers: HEADERS }
      );
    }

    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: HEADERS,
    });
  } catch (error) {
    console.error('Stripe checkout exception:', error);
    return new Response(
      JSON.stringify({ url: null, error: 'Server error' }),
      { status: 500, headers: HEADERS }
    );
  }
}
