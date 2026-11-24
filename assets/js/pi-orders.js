const connect = document.querySelector('#connect');
const status = document.querySelector('#status');
const workspace = document.querySelector('#workspace');
const form = document.querySelector('#order');
const list = document.querySelector('#orders');
let initialized = false;
let accountKey = null;
let orders = [];
let visibleSharedOrders = [];

function renderOrders() {
  list.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No orders recorded yet.';
    list.append(empty);
    return;
  }

  for (const order of orders) {
    const row = document.createElement('li');
    const description = document.createElement('span');
    description.textContent = `${order.title} · ${order.direction} · ${order.amount} Pi · ${order.state}`;
    const action = document.createElement('button');
    action.textContent = order.state === 'Open' ? 'Mark delivered' : 'Reopen';
    action.addEventListener('click', () => {
      const state = order.state === 'Open' ? 'Delivered' : 'Open';
      saveOrders(orders.map(item => item.id === order.id ? { ...item, state } : item));
    });
    row.append(description, action);
    list.append(row);
  }
}

function saveOrders(updatedOrders) {
  try {
    localStorage.setItem(accountKey, JSON.stringify(updatedOrders));
    orders = updatedOrders;
    renderOrders();
    status.textContent = 'Order changes saved on this device.';
    return true;
  } catch {
    status.textContent = 'Could not save your changes. Check whether browser storage is available.';
    return false;
  }
}

connect.addEventListener('click', async () => {
  if (accountKey) {
    accountKey = null;
    orders = [];
    list.replaceChildren();
    form.reset();
    clearSharedSession();
    workspace.hidden = true;
    connect.textContent = 'Connect with Pi';
    status.textContent = 'Order book closed.';
    return;
  }

  if (!window.Pi) {
    status.textContent = 'Pi sign-in is unavailable. Open this page in Pi Browser and try again.';
    return;
  }

  connect.disabled = true;
  try {
    if (!initialized) {
      window.Pi.init({ version: '2.0', sandbox: false });
      initialized = true;
    }
    const { user, accessToken } = await window.Pi.authenticate(['username'], () => {});
    if (!user?.uid || !user.username) throw new Error('Missing Pi identity');
    const key = `a-network-pi-orders:v1:${user.uid}`;
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid order storage');
    orders = saved;
    accountKey = key;
    renderOrders();
    workspace.hidden = false;
    startSharedSession(accessToken);
    connect.textContent = 'Close order book';
    status.textContent = `Connected as @${user.username}.`;
  } catch {
    accountKey = null;
    clearSharedSession();
    workspace.hidden = true;
    status.textContent = 'Could not open your order book. Check Pi Browser and local storage, then retry.';
  } finally {
    connect.disabled = false;
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!accountKey) return;
  const data = new FormData(form);
  const title = data.get('title').trim();
  const amount = data.get('amount');
  if (!title || !/^[0-9]{1,9}(\.[0-9]{1,7})?$/.test(amount) || Number(amount) <= 0) {
    status.textContent = 'Enter an order name and a positive Pi amount.';
    return;
  }

  if (saveOrders([{ id: crypto.randomUUID(), title, amount, direction: data.get('direction'), state: 'Open' }, ...orders])) {
    form.reset();
  }
});

const sharedForm = document.querySelector('#shared-order');
const sharedStatus = document.querySelector('#shared-status');
const sharedList = document.querySelector('#shared-orders');
const incomingInvite = document.querySelector('#incoming-invite');
const refreshButton = document.querySelector('#refresh-orders');
let sharedSession = null;

function clearSharedSession() {
  sharedSession?.controller.abort();
  sharedSession = null;
  sharedForm.reset();
  sharedStatus.textContent = '';
  sharedList.replaceChildren();
  incomingInvite.replaceChildren();
  visibleSharedOrders = [];
}

function startSharedSession(token) {
  if (!token) {
    sharedStatus.textContent = 'Reconnect with Pi to use shared orders.';
    return;
  }
  sharedSession = { token, controller: new AbortController(), pending: false, draft: null };
  runSharedAction(refreshShared);
}

async function ordersApi(session, body, inviteId) {
  const url = new URL('/api/orders', location.origin);
  if (inviteId) url.searchParams.set('invite', inviteId);
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${session.token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: session.controller.signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load shared orders.');
  return result;
}

async function runSharedAction(action) {
  const session = sharedSession;
  if (!session || session.pending) return;
  session.pending = true;
  sharedStatus.textContent = 'Updating shared orders…';
  try {
    const message = await action(session);
    if (sharedSession === session) sharedStatus.textContent = message || '';
  } catch (error) {
    if (sharedSession === session) sharedStatus.textContent = error.message;
  } finally {
    session.pending = false;
  }
}

function actionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function transition(action, id) {
  runSharedAction(async session => {
    await ordersApi(session, { action, id });
    if (action === 'accept' && sharedSession === session) history.replaceState(null, '', location.pathname + location.search);
    return refreshShared(session);
  });
}

function renderSharedOrders(orders) {
  sharedList.replaceChildren();
  for (const order of orders) {
    const row = document.createElement('li');
    const details = document.createElement('span');
    details.textContent = `${order.title} · ${order.amount} Pi · due ${order.due} · ${order.role} · ${order.state}`;
    row.append(details);
    if (order.state === 'Invited') {
      const url = new URL(location.href);
      url.hash = `invite=${order.id}`;
      const link = document.createElement('input');
      link.readOnly = true;
      link.value = url.href;
      link.setAttribute('aria-label', 'Buyer invitation URL');
      link.addEventListener('focus', () => link.select());
      const controls = document.createElement('div');
      controls.className = 'invite-controls';
      controls.append(link, actionButton('Copy invite', async () => {
        try {
          await navigator.clipboard.writeText(link.value);
          if (link.isConnected) sharedStatus.textContent = 'Invite copied. Share it privately with your buyer.';
        } catch {
          if (!link.isConnected) return;
          link.focus();
          link.select();
          sharedStatus.textContent = 'Copy the selected invitation link.';
        }
      }));
      row.append(controls);
    }
    if (order.role === 'Seller' && order.state === 'Accepted') {
      row.append(actionButton('Mark sent', () => transition('ship', order.id)));
    }
    if (order.role === 'Buyer' && order.state === 'Shipped') {
      row.append(actionButton('Confirm delivery', () => transition('deliver', order.id)));
    }
    sharedList.append(row);
  }
}

async function refreshShared(session) {
  const result = await ordersApi(session);
  if (sharedSession !== session) return;
  visibleSharedOrders = result.orders;
  renderSharedOrders(visibleSharedOrders);
  incomingInvite.replaceChildren();
  const inviteId = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!inviteId) return result.orders.length ? '' : 'No shared orders yet.';
  const { invite } = await ordersApi(session, undefined, inviteId);
  if (sharedSession !== session) return;
  const summary = document.createElement('p');
  summary.textContent = `Invitation: ${invite.title} · ${invite.amount} Pi · due ${invite.due}`;
  incomingInvite.append(summary, actionButton('Accept order', () => transition('accept', invite.id)));
}

sharedForm.addEventListener('submit', event => {
  event.preventDefault();
  runSharedAction(async session => {
    const data = Object.fromEntries(new FormData(sharedForm));
    const signature = JSON.stringify(data);
    if (session.draft?.signature !== signature) session.draft = { signature, id: crypto.randomUUID() };
    await ordersApi(session, { action: 'create', id: session.draft.id, ...data });
    if (sharedSession !== session) return;
    session.draft = null;
    sharedForm.reset();
    return refreshShared(session);
  });
});

refreshButton.addEventListener('click', () => runSharedAction(refreshShared));
window.addEventListener('hashchange', () => runSharedAction(refreshShared));

function orderCsvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

document.querySelector('#export-orders').addEventListener('click', () => {
  if (!accountKey) return;
  const shared = visibleSharedOrders.map(({ title, role, amount, due, state }) => ['Shared', title, role, amount, due, state]);
  const personal = orders.map(({ title, direction, amount, state }) => ['Personal', title, direction, amount, '', state]);
  if (!shared.length && !personal.length) {
    status.textContent = 'Add or refresh an order before exporting.';
    return;
  }

  const rows = [['Type', 'Order', 'Role', 'Amount (Pi)', 'Due date', 'Status'], ...shared, ...personal];
  const csv = rows.map(row => row.map(orderCsvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'a-network-orders.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Exported the orders currently shown.';
});
