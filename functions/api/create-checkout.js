import Stripe from 'stripe';

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
  try {
    const stripeSecret = env.STRIPE_SECRET_KEY;
    const priceId = env.STRIPE_PRICE_ID_MONTHLY;

    if (!stripeSecret || !priceId) {
      return new Response(
        JSON.stringify({ url: null, error: 'Missing Stripe config' }),
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    const stripe = new Stripe(stripeSecret);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://groundedthroughfaith.org/membership?status=success',
      cancel_url: 'https://groundedthroughfaith.org/membership?status=cancelled',
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: DEFAULT_HEADERS,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return new Response(
      JSON.stringify({ url: null, error: 'Stripe error' }),
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
}
