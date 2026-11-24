import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../../pi-orders-deploy/functions/api/orders.js';

test('Pi-verified seller and buyer can complete a shared order', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../pi-orders-deploy/schema.sql', import.meta.url), 'utf8'));
  const ORDERS = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...params) {
        return {
          run: () => ({ meta: statement.run(...params) }),
          first: () => statement.get(...params),
          all: () => ({ results: statement.all(...params) })
        };
      } };
    }
  };
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.minepi.com/v2/me');
    const uid = options.headers.Authorization.slice(7);
    return ['seller', 'buyer', 'other'].includes(uid) ?
      Response.json({ uid, username: uid }) : new Response(null, { status: 401 });
  });
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const invoke = (user, body, invite = '') => onRequest({
    env: { ORDERS },
    request: new Request('https://example.com/api/orders' + invite, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + user },
      body: body && JSON.stringify(body)
    })
  });
  const update = (user, action) => invoke(user, { action, id });
  const draft = { action: 'create', id, title: 'Logo design', amount: '2.5', due: '2099-10-02' };
  try {
    assert.equal((await invoke('unknown')).status, 401);
    assert.equal((await invoke('seller', { ...draft, due: '2099-02-30' })).status, 400);
    assert.equal((await invoke('seller', draft)).status, 200);
    assert.equal((await invoke('seller', draft)).status, 200);
    assert.equal((await invoke('seller').then(r => r.json())).orders.length, 1);
    assert.equal((await update('seller', 'accept')).status, 409);
    assert.equal((await invoke('buyer', null, '?invite=' + id).then(r => r.json())).invite.title, 'Logo design');
    assert.equal((await update('buyer', 'accept')).status, 200);
    assert.equal((await update('other', 'accept')).status, 409);
    assert.equal((await invoke('other').then(r => r.json())).orders.length, 0);
    assert.equal((await update('buyer', 'ship')).status, 409);
    assert.equal((await update('seller', 'ship')).status, 200);
    assert.equal((await update('seller', 'deliver')).status, 409);
    assert.equal((await update('buyer', 'deliver')).status, 200);
    for (const user of ['seller', 'buyer']) {
      assert.equal((await invoke(user).then(r => r.json())).orders[0].state, 'Delivered');
    }
  } finally {
    mock.restoreAll();
    sqlite.close();
  }
});
