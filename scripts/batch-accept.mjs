#!/usr/bin/env node
/**
 * 批量编辑(spec 2026-10-17)真机逐项验收。
 * 前置:`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev`
 * (或装机版同参数启动);真实库读写一律走应用自己的写路径,夹具自建自删,收尾前后对照。
 *
 * 段:
 *  A 入口与选择态:开筛选(正文独有串) -> 开批量 -> 全选筛选结果 -> 计数 3 -> Esc 退批量
 *  B 加标签:UI 输入框 + 加标签 -> 库逐条核对 -> 再点一次(幂等)
 *  C 去标签:先造一条名线(create_line,真名点「状态」) -> 去标签 -> 无名字线 0 / 名线 1(未动)
 *  D 删除:勾 2 条 -> 原生确认框(win32 点「确定」) -> 快照落盘 + 库 -2;再删余下 1 条
 *  E 导出选中:UI 点按 -> 原生另存为框出现(CDP 驱动不了系统框,出现即证 UI 通路)-> 取消;
 *    行数核对走同一条 IPC `export_points_of`(列数与整库导出一致)
 *  F 夹具零残留:points / lines / points_fts / 夹具正文命中 全回基线
 * 步间等待一律按**本步独有的回执文案**或**按钮可用**判:回执停留 5s,读"有值"会读到上一步的旧文案。
 * 产物:.superpowers/shots/batch-*.png(不入库)
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { ensureMain, waitFor, recorder, bindMain, sleep } from './cdp-lib.mjs';
import { openReadOnly, DB_PATH } from './db-compat.mjs';
import { os } from './cdp-os.mjs';

const DB = DB_PATH;
const SHOTS = '.superpowers/shots';
const TMP_XLSX = 'C:/tmp/batch-accept-选中.xlsx';
const J = JSON.stringify;
const R = recorder();
const rec = (item, ok, detail) => R.record(item, ok, detail);

const one = (sql) => {
  const c = openReadOnly(DB);
  const n = Number(c.prepare(sql).all()[0]?.n ?? 0);
  c.close();
  return n;
};
const base = () => ({
  points: one('select count(*) n from points'),
  lines: one('select count(*) n from lines'),
  fts: one('select count(*) n from points_fts'),
});
const conds = (key) => ({
  keyword: null, tags: [], excludeTags: [], relations: [], excludeRelations: [], tagPresence: null,
  sort: 'newest', sorts: [], groupBy: null, expr: null, groupOp: 'and',
  groups: [{ op: 'and', items: [{ kind: 'keyword', value: key }] }],
});

const { cdp, close } = await ensureMain();
const { call } = bindMain(cdp);
const pid = os.pidOf();
const sel = (s) => `document.querySelector(${J(s)})`;
const text = (s) => cdp.eval(`(${sel(s)})?.textContent ?? null`);
const click = (s) => cdp.eval(`(() => { const e = ${sel(s)}; if (!e) return false; e.click(); return true; })()`);
/** 按本步独有的回执文案等(旧文案不会命中) */
const waitNotice = (re, tries = 24) => waitFor(async () => {
  const t = await text('[data-testid="batch-notice"]');
  return t && re.test(t) ? t : null;
}, tries, 300);
/** 按钮可用(在途 / 0 选时是 disabled,点了没用) */
const enabled = (id) => waitFor(() => cdp.eval(`(() => { const b = ${sel(`[data-testid="${id}"]`)}; return !!b && !b.disabled; })()`), 20, 250);
const shot = async (name) => {
  mkdirSync(SHOTS, { recursive: true });
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
};

const before = base();
const filterBefore = await call('get_setting', { key: 'filter_current' });
const nameId = one("select id n from points where meta = '状态' and path is null order by id limit 1");
const token = '批量验收' + Date.now().toString(36);
const tag = (await call('list_tags')).find((t) => t.path && !t.path.startsWith('时间/'));
const target = tag.id;
console.log(`INFO 夹具串=${token} 目标标签=${tag.path}#${target} 名点=${nameId} 基线=${JSON.stringify(before)}`);

// 夹具:3 条正文独有串的笔记(树外点;时间标签由应用自己补,不新造标签)
const made = [];
for (let i = 1; i <= 3; i++) made.push(await call('save_input_note', { content: `${token} 夹具 ${i}` }));
const ids = made.map((n) => n.id);
await sleep(600);
await call('set_setting', { key: 'filter_current', value: JSON.stringify(conds(token)) });
await cdp.send('Page.reload', { ignoreCache: false });
await waitFor(() => cdp.eval(`!!${sel('[data-testid="unified-input"]')}`), 40, 250);
const hitIds = await waitFor(async () => {
  const list = (await call('query_notes', { conditions: conds(token), offset: 0 })).map((n) => n.id);
  return list.length === 3 ? list : null;
}, 20, 250);
rec('A1 筛选命中夹具 3 条', JSON.stringify([...(hitIds ?? [])].sort()) === JSON.stringify([...ids].sort()), `命中=${hitIds}`);

// A: 开批量 -> 全选筛选结果 -> Esc 退批量
await click('[data-testid="batch-toggle"]');
rec('A2 开关态 data-batch=on', (await cdp.eval(`${sel('[data-testid="batch-toggle"]')}.dataset.batch`)) === 'on');
await click('[data-testid="batch-select-all"]');
rec('A3 全选筛选结果 -> 已选 3 条', (await waitFor(async () => ((await text('[data-testid="batch-count"]')) === '已选 3 条' ? 1 : null), 20, 250)) === 1);
await shot('batch-01-selected');
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
rec('A4 Esc 退批量并清选中', (await waitFor(() => cdp.eval(`!${sel('[data-testid="batch-bar"]')}`), 12, 200)) === true);
await click('[data-testid="batch-toggle"]');
await click('[data-testid="batch-select-all"]');
await waitFor(async () => ((await text('[data-testid="batch-count"]')) === '已选 3 条' ? 1 : null), 20, 250);

// B: 加标签(输入框 + 按钮),幂等
const fill = async (v) => cdp.eval(`(() => { const i = ${sel('[data-testid="batch-tag-input"]')};
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i, ${J(v)});
  i.dispatchEvent(new Event('input',{bubbles:true})); return i.value; })()`);
const unnamed = () => one(`select count(*) n from lines where name_id is null and to_id = ${target} and from_id in (${ids.join(',')})`);
const named = () => one(`select count(*) n from lines where name_id is not null and to_id = ${target} and from_id in (${ids.join(',')})`);

await fill(tag.path);
await enabled('batch-tag-add') && (await click('[data-testid="batch-tag-add"]'));
const n1 = await waitNotice(/已给 3 条加/);
rec('B1 回执「已给 3 条加」', !!n1, String(n1));
rec('B2 库里 3 条无名字线', (await waitFor(async () => ((await unnamed()) === 3 ? 1 : null), 24, 300)) === 1, `unnamed=${await unnamed()}`);
await enabled('batch-tag-add');
await fill(tag.path);
await click('[data-testid="batch-tag-add"]');
const n2 = await waitNotice(/3 条已有/);
rec('B3 幂等:回执「3 条已有」且线数不变', !!n2 && (await unnamed()) === 3, `${n2} unnamed=${await unnamed()}`);

// C: 名线不动
await call('create_line', { fromId: ids[0], toId: target, nameId: nameId });
await enabled('batch-tag-remove');
await fill(tag.path);
await click('[data-testid="batch-tag-remove"]');
const n3 = await waitNotice(/带同名关系，未动/);
await waitFor(async () => ((await unnamed()) === 0 ? 1 : null), 24, 300);
rec('C1 去标签:无名字线清零', (await unnamed()) === 0, `unnamed=${await unnamed()}`);
rec('C2 名线未动且回执交代', (await named()) === 1 && /已从 3 条去掉/.test(String(n3)), `${n3} named=${await named()}`);
await shot('batch-02-untag');

// E(先做导出,此时 3 条仍选中):UI 通路 + IPC 行数核对
await enabled('batch-export') && (await click('[data-testid="batch-export"]'));
const dlg = await waitFor(async () => os.wins(pid).some((w) => w.cls === '#32770'), 12, 300);
rec('E1 点「导出选中」弹原生另存为框', dlg === true);
if (dlg) {
  os.closeDialog(pid);
  await waitFor(async () => !os.wins(pid).some((w) => w.cls === '#32770'), 8, 300);
}
await call('export_points_of', { path: TMP_XLSX, ids });
const xlsxRows = await waitFor(async () => {
  const { execSync } = await import('node:child_process');
  const out = execSync(`python -c "import zipfile,re;x=zipfile.ZipFile(r'${TMP_XLSX}').read('xl/worksheets/sheet1.xml').decode();print(len(re.findall('<row ',x)))"`, { encoding: 'utf8' });
  return Number(out.trim());
}, 10, 300);
rec('E2 导出选中行数 = 3 条 + 表头', xlsxRows === 4, `rows=${xlsxRows}`);

// D: 删除 2 条(原生确认 -> 快照 -> 库 -2)
await click('[data-testid="batch-cancel"]');
await click('[data-testid="batch-toggle"]');
await cdp.eval(`(() => { const b = document.querySelectorAll('[data-testid="batch-check"]');
  b[0].click(); b[1].click(); return b.length; })()`);
rec('D0 勾 2 条', (await waitFor(async () => ((await text('[data-testid="batch-count"]')) === '已选 2 条' ? 1 : null), 12, 250)) === 1);
await enabled('batch-delete') && (await click('[data-testid="batch-delete"]'));
const dlg2 = await waitFor(async () => os.wins(pid).some((w) => w.cls === '#32770'), 12, 300);
rec('D1 删除先弹二次确认', dlg2 === true);
if (dlg2) os.clickOk(pid, '批量删除');
const n4 = await waitNotice(/已删除 2 条/);
const snap = /快照：(.+)$/.exec(String(n4 ?? ''))?.[1]?.trim();
rec('D2 回执带快照路径且文件存在', !!snap && existsSync(snap), `${n4} -> ${snap}`);
rec('D3 库少 2 条', (await waitFor(async () => ((await one('select count(*) n from points')) === before.points + 1 ? 1 : null), 24, 300)) === 1,
  `points=${await one('select count(*) n from points')} 期望=${before.points + 1}`);
await shot('batch-03-deleted');

// F: 删掉余下 1 条,夹具回基线
await click('[data-testid="batch-cancel"]');
await click('[data-testid="batch-toggle"]');
await cdp.eval(`document.querySelectorAll('[data-testid="batch-check"]')[0].click()`);
await enabled('batch-delete') && (await click('[data-testid="batch-delete"]'));
if (await waitFor(async () => os.wins(pid).some((w) => w.cls === '#32770'), 12, 300)) os.clickOk(pid, '批量删除');
await waitNotice(/已删除 1 条/);
await waitFor(async () => ((await one('select count(*) n from points')) === before.points ? 1 : null), 24, 300);
const after = base();
rec('F1 points/lines 回基线', after.points === before.points && after.lines === before.lines, JSON.stringify({ before, after }));
rec('F2 points_fts 回基线', after.fts === before.fts, `fts ${before.fts} -> ${after.fts}`);
rec('F3 夹具正文命中 0', (await one(`select count(*) n from points where meta like '%${token}%'`)) === 0);
await call('set_setting', { key: 'filter_current', value: filterBefore ?? 'null' });
await cdp.send('Page.reload', { ignoreCache: false });
await sleep(400);
rec('F4 filter_current 复原', (await call('get_setting', { key: 'filter_current' })) === filterBefore, `${String(filterBefore).slice(0, 40)}`);
close();
R.finish();
