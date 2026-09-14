// MVP-3 Task 5 端到端验收(CDP 驱动真实 dev 应用)
// 用法: node scripts/dev-cdp-accept.mjs  (需先以 9222 调试端口启动 pnpm tauri dev)
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pages() {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  return list.filter((p) => p.type === 'page');
}

// 极简 CDP 客户端
class Cdp {
  static id = 0;
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.events = [];
    const onMsg = (raw) => {
      const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    };
    if (ws.on) ws.on('message', onMsg);
    else ws.addEventListener('message', (e) => onMsg(e.data));
  }
  send(method, params = {}) {
    const id = ++Cdp.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
}

const results = [];
function record(item, ok, detail) {
  results.push({ item, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${item}  ${detail ?? ''}`);
}

// ---- 启动 ----
const { default: WebSocket } = await import('ws').catch(() => ({ default: null }));
let wsImpl = WebSocket;
if (!wsImpl) {
  // 尝试全局 WebSocket(Node 22+ 自带)
  wsImpl = globalThis.WebSocket;
}

const list = await pages();
const main = list.find((p) => p.url.includes('localhost:5173') && p.title.includes('生活')) || list.find((p) => p.url.includes('5173'));
const input = list.find((p) => p.url.includes('input.html'));

if (!main || !input) {
  console.log('页面清单:', list.map((p) => `${p.title} | ${p.url}`));
  throw new Error('未找到主窗/输入栏页面');
}

const mainWs = new wsImpl(main.webSocketDebuggerUrl);
if (mainWs.on) {
  await new Promise((r) => mainWs.on('open', r));
} else {
  await new Promise((r) => { mainWs.addEventListener('open', r); });
}
const mainCdp = new Cdp(mainWs);
await mainCdp.send('Runtime.enable');

console.log('主窗就绪:', main.title, main.url);

// 库存快照(验收前后对照)
const inventory = await mainCdp.eval(`(async () => {
  const notes = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: { keyword: null, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest' }, offset: 0 });
  const tags = await window.__TAURI_INTERNALS__.invoke('list_tags');
  const views = await window.__TAURI_INTERNALS__.invoke('list_views');
  return { notes: notes.length, tagPaths: tags.map(t => t.path).sort(), views: views.length };
})()`);
console.log('验收前库存:', JSON.stringify(inventory));

console.log('\n=== 按条验收(核心项) ===');

const F = (over) => JSON.stringify({ keyword: null, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest', ...over });
const q = async (over) => mainCdp.eval(`(async () => { const r = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: ${F(over)}, offset: 0 }); return r.length; })()`);

// 0 基线测量(必须在 seed 之前!)
const baseSub = await q({ tags: [{ path: '工作', includeChildren: true }] });
const baseAnd = await q({ tags: [{ path: '工作/项目A', includeChildren: true }, { path: '工作/项目A/会议', includeChildren: false }] });
const baseEx = await q({ tags: [{ path: '工作', includeChildren: true }], excludeTags: [{ path: '工作/项目B', includeChildren: true }] });
const baseNone = await q({ tagPresence: 'none' });

// 造测试数据(带子树标签 + 日期差) —— 通过保存命令走真实链路
const seed = [
  '#工作/项目A/会议 会议记录一',
  '#工作/项目A/会议 会议记录二',
  '#工作/项目B 别的事',
  '#生活/健身 跑了五公里',
  '#临时 便签一条',
  '没有任何标签的裸笔记',
];
for (const content of seed) {
  await mainCdp.eval(`(async () => { await window.__TAURI_INTERNALS__.invoke('save_input_note', { content: ${JSON.stringify(content)} }); return true; })()`);
}

// 1 含子级命中子孙(seed 应增加 3:会议2+项目B1)
const nSub = await q({ tags: [{ path: '工作', includeChildren: true }] });
record('1 含子级(工作)较基线+3', nSub - baseSub === 3, `基线 ${baseSub} 实际 ${nSub}`);
// 2 仅本级不命中
const nSelf = await q({ tags: [{ path: '工作', includeChildren: false }] });
record('2 仅本级(工作)=0', nSelf === 0, `实际 ${nSelf}`);
// 3 多标签 AND
const nAnd = await q({ tags: [{ path: '工作/项目A', includeChildren: true }, { path: '工作/项目A/会议', includeChildren: false }] });
record('3 AND(项目A含子级+会议本级)较基线+2', nAnd - baseAnd === 2, `基线 ${baseAnd} 实际 ${nAnd}`);
// 4 排除
const nEx = await q({ tags: [{ path: '工作', includeChildren: true }], excludeTags: [{ path: '工作/项目B', includeChildren: true }] });
record('4 排除项目B较基线+2', nEx - baseEx === 2, `基线 ${baseEx} 实际 ${nEx}`);
// 5 无标签
const nNone = await q({ tagPresence: 'none' });
record('5 无标签较基线+1(裸笔记)', nNone - baseNone === 1, `基线 ${baseNone} 实际 ${nNone}`);
// 6 排序
const oldest = await mainCdp.eval(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: ${F({ sort: 'oldest' })}, offset: 0 });
  return r.map(x => x.id);
})()`);
record('6 最早在前(升序)', JSON.stringify(oldest) === JSON.stringify([...oldest].sort((a, b) => a - b)), JSON.stringify(oldest).slice(0, 40));
// 7 视图保存/应用/重命名/删除
const vid = await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('create_view', { title: '验收视图', conditions: ${F({ tags: [{ path: '工作', includeChildren: true }] })} }))()`);
const hits = await mainCdp.eval(`(async () => { const h = await window.__TAURI_INTERNALS__.invoke('count_view_hits'); return Object.fromEntries(h); })()`);
record('7a 视图保存+徽标=基线含子级+3', hits['view:' + vid] === baseSub + 3, `vid=${vid} hits=${JSON.stringify(hits['view:' + vid])} 基线${baseSub}`);
await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('update_view', { id: ${vid}, title: '验收视图改', conditions: ${F({})} }))()`);
const viewsNow = await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('list_views'))()`);
record('7b 重命名生效', viewsNow.find((v) => v.id === vid)?.title === '验收视图改', '');
// 8 重命名父标签级联(视图条件跟随)
const tagList = await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('list_tags'))()`);
const tagA = tagList.find((t) => t.path === '工作/项目A');
await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('rename_tag', { tagId: ${tagA.id}, newName: '项目X' }))()`);
const viewsAfter = await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('list_views'))()`);
const searchHit = await mainCdp.eval(`(async () => { const r = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: ${F({ tags: [{ path: '工作/项目X', includeChildren: true }] })}, offset: 0 }); return r.length; })()`);
const tagX = await mainCdp.eval(`(async () => (await window.__TAURI_INTERNALS__.invoke('list_tags')).some(t => t.path === '工作/项目X'))()`);
const workCountSame = await mainCdp.eval(`(async () => (await window.__TAURI_INTERNALS__.invoke('list_tags')).find(t => t.path === '工作')?.subtree_count)()`);
record('8 改名后级联(路径已改,工作子树计数不丢)', tagX && searchHit >= 2 && workCountSame >= 2, `tagX=${tagX} searchHit=${searchHit} 工作子树=${workCountSame}`);
// 还原改名
await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('rename_tag', { tagId: ${tagA.id}, newName: '项目A' }))()`);
// 9 删除视图
await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('delete_view', { id: ${vid} }))()`);
const viewsFinal = await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('list_views'))()`);
record('9 删除视图', !viewsFinal.some((v) => v.id === vid), '');

// 10 UI 空态区分(无匹配 + 清空按钮存在)
await mainCdp.eval(`(async () => {
  const input = Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('搜索笔记')) || document.querySelector('input[type="text"]');
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '绝不存在的关键词xyz');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(600);
const emptyUi = await mainCdp.eval(`(() => {
  const t = document.body.innerText;
  return { noMatch: t.includes('没有符合当前条件的笔记'), clearBtn: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '清空条件') };
})()`);
record('10 无匹配空态+清空条件按钮', emptyUi.noMatch && emptyUi.clearBtn, JSON.stringify(emptyUi));
// 清空条件恢复
await mainCdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '清空条件'); b && b.click(); return true; })()`);
await sleep(400);

// 11 清理测试数据(还原库存)
const seeded = await mainCdp.eval(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: ${F({})}, offset: 0 });
  const words = ${JSON.stringify(seed.map((s) => s.startsWith('#') ? s.split(' ').slice(1).join(' ') : s))};
  return all.filter(n => words.some(w => n.content === w || (n.content.split(String.fromCharCode(10))[0] === w && n.content.length > w.length))).map(n => n.id);


})()`);
for (const id of seeded) {
  await mainCdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('delete_note', { id: ${id} }))()`);
}
const finalInv = await mainCdp.eval(`(async () => {
  const notes = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: ${F({})}, offset: 0 });
  const tags = await window.__TAURI_INTERNALS__.invoke('list_tags');
  const views = await window.__TAURI_INTERNALS__.invoke('list_views');
  return { notes: notes.length, tagPaths: tags.map(t => t.path).sort(), views: views.length };
})()`);
const extra = await mainCdp.eval(`(async () => {
  const F0 = { keyword: null, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest' };
  const r = await window.__TAURI_INTERNALS__.invoke('query_notes', { conditions: F0, offset: 0 });
  return r.map(n => n.content.slice(0, 16)).filter(c => !['买牛奶','第一行缩进','完全摆烂','CDP补全回归一','CDP回归二','CDP回归三'].some(k => c.startsWith(k)));
})()`);
const sameNotes = finalInv.notes === inventory.notes;
const sameTags = JSON.stringify(finalInv.tagPaths) === JSON.stringify(inventory.tagPaths);
record('11 库存还原', sameNotes && sameTags, `notes ${finalInv.notes}/${inventory.notes} 残留=${JSON.stringify(extra)} tags ${sameTags ? '同' : '异'}`);

console.log('\n=== 汇总 ===');
const fails = results.filter((r) => !r.ok);
console.log(`通过 ${results.length - fails.length}/${results.length}`);
if (fails.length) { fails.forEach((f) => console.log('FAIL 明细:', f.item, f.detail)); process.exitCode = 1; }
try { mainWs.close(); } catch {}
