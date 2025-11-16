const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_PRICE = '$5/month';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestGet({ env }) {
  const payload = {
    priceLabel: DEFAULT_PRICE,
    checkoutReady: Boolean((env.Membership || '').trim() && (env.STRIPE_SECRET_KEY || '').trim()),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: DEFAULT_HEADERS,
  });
}
