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
  const membershipUrl = (env.Membership || '').trim();
  const payload = {
    membershipUrl,
    priceLabel: DEFAULT_PRICE,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: DEFAULT_HEADERS,
  });
}
