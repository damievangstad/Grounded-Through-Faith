// functions/api/geocode.js
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const { query } = await request.json();

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing query' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    url.searchParams.set('access_token', env.MAPBOX_TOKEN); // server-side secret
    url.searchParams.set('limit', '5');

    const r = await fetch(url.toString());
    if (!r.ok) {
      const detail = await r.text();
      return new Response(JSON.stringify({ error: 'Mapbox error', detail }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await r.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
