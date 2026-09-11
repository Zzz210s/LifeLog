#!/usr/bin/env node
// CDP driver for release-exe testing. Usage:
//   node scripts/dev-cdp.mjs <expression> [--page quick|main]
// Evaluates the expression in the chosen window, returns JSON on stdout.
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const pageSel = args.includes('--page') ? args[args.indexOf('--page') + 1] : 'quick';
const expr = args.filter((a, i) => a !== '--page' && args[i - 1] !== '--page').join(' ');
if (!expr) { console.error('usage: dev-cdp.mjs <expression> [--page quick|main]'); process.exit(2); }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const want = pageSel === 'main' ? (t) => !t.url.includes('quick.html') : (t) => t.url.includes('quick.html');
const target = list.find((t) => t.type === 'page' && want(t));
if (!target) { console.error('no target found; pages: ' + list.map((t) => t.url).join(', ')); process.exit(3); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
try {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    console.log(JSON.stringify({ ok: false, error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }));
  } else {
    console.log(JSON.stringify({ ok: true, value: r.result.value ?? r.result.description }));
  }
} finally {
  ws.close();
}
await sleep(100);
