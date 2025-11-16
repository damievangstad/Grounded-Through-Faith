const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestGet({ env }) {
  const membershipLink = (env.STRIPE_PAYMENT_LINK || '').trim();
  const payload = {
    checkoutReady: Boolean(membershipLink),
    membershipLink: membershipLink || null,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: DEFAULT_HEADERS,
  });
}
