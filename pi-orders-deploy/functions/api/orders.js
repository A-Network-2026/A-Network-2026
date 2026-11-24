const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function identity(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) return null;
  const response = await fetch('https://api.minepi.com/v2/me', {
    headers: { Authorization: authorization },
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error('Pi identity service unavailable');
  const result = await response.json();
  const user = result.user ?? result;
  if (typeof user.uid !== 'string' || !user.uid || typeof user.username !== 'string') {
    throw new Error('Unexpected Pi identity response');
  }
  return user;
}

export async function onRequest({ request, env }) {
  try {
    const user = await identity(request);
    if (!user) return reply(401, { error: 'Reconnect with Pi and try again.' });
    const db = env.ORDERS;
    const id = new URL(request.url).searchParams.get('invite');

    if (request.method === 'GET') {
      if (id !== null) {
        if (!idPattern.test(id)) return reply(404, { error: 'Invite unavailable.' });
        const order = await db.prepare("SELECT id, title, amount, due FROM shared_orders WHERE id = ? AND state = 'Invited' AND seller <> ?").bind(id, user.uid).first();
        return order ? reply(200, { invite: order }) : reply(404, { error: 'Invite unavailable.' });
      }

      const { results } = await db.prepare(
        "SELECT id, title, amount, due, state, CASE WHEN seller = ? THEN 'Seller' ELSE 'Buyer' END AS role FROM shared_orders WHERE seller = ? OR buyer = ? ORDER BY created DESC"
      ).bind(user.uid, user.uid, user.uid).all();
      return reply(200, { username: user.username, orders: results });
    }

    if (request.method !== 'POST') return reply(405, { error: 'Method unavailable.' });
    const raw = await request.text();
    if (raw.length > 4096) return reply(413, { error: 'Order details are too long.' });
    let input;
    try { input = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid order details.' }); }
    if (!input || typeof input !== 'object') return reply(400, { error: 'Invalid order details.' });

    if (input.action === 'create') {
      const { id, title, amount, due } = input;
      if (typeof id !== 'string' || !idPattern.test(id) ||
          typeof title !== 'string' || !title.trim() || title.length > 100 ||
          typeof amount !== 'string' || !/^[0-9]{1,9}(\.[0-9]{1,7})?$/.test(amount) || Number(amount) <= 0 ||
          typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
          new Date(due).toJSON()?.slice(0, 10) !== due || due < new Date().toISOString().slice(0, 10)) {
        return reply(400, { error: 'Enter an order name, a positive Pi amount, and a valid due date.' });
      }
      await db.prepare("INSERT INTO shared_orders (id, seller, title, amount, due, state) VALUES (?, ?, ?, ?, ?, 'Invited') ON CONFLICT(id) DO NOTHING")
        .bind(id, user.uid, title.trim(), amount, due).run();
      const saved = await db.prepare('SELECT id FROM shared_orders WHERE id = ? AND seller = ?').bind(id, user.uid).first();
      return saved ? reply(200, { ok: true }) : reply(409, { error: 'Could not create this order.' });
    }

    const transitions = {
      accept: "UPDATE shared_orders SET buyer = ?, state = 'Accepted' WHERE id = ? AND state = 'Invited' AND seller <> ?",
      ship: "UPDATE shared_orders SET state = 'Shipped' WHERE id = ? AND seller = ? AND state = 'Accepted'",
      deliver: "UPDATE shared_orders SET state = 'Delivered' WHERE id = ? AND buyer = ? AND state = 'Shipped'"
    };
    if (typeof input.id !== 'string' || !idPattern.test(input.id) || !Object.hasOwn(transitions, input.action)) {
      return reply(400, { error: 'Invalid order action.' });
    }
    const params = input.action === 'accept' ? [user.uid, input.id, user.uid] : [input.id, user.uid];
    const result = await db.prepare(transitions[input.action]).bind(...params).run();
    return result.meta.changes === 1 ? reply(200, { ok: true }) :
      reply(409, { error: 'This action is unavailable. Refresh orders to see the current status.' });
  } catch {
    return reply(503, { error: 'Order Book is temporarily unavailable. Try again shortly.' });
  }
}
