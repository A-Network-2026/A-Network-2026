const connect = document.querySelector('#connect');
const status = document.querySelector('#status');
const workspace = document.querySelector('#workspace');
const form = document.querySelector('#order');
const list = document.querySelector('#orders');
let initialized = false;
let accountKey = null;
let orders = [];

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
    const { user } = await window.Pi.authenticate(['username'], () => {});
    if (!user?.uid || !user.username) throw new Error('Missing Pi identity');
    const key = `a-network-pi-orders:v1:${user.uid}`;
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid order storage');
    orders = saved;
    accountKey = key;
    renderOrders();
    workspace.hidden = false;
    connect.textContent = 'Close order book';
    status.textContent = `Connected as @${user.username}.`;
  } catch {
    accountKey = null;
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
