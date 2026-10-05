// 标签角色端到端验收(scripts/dev-roles-accept.mjs)的共用件:只做「只读库对账 / 发 IPC /
// 发 DOM 事件 / 读值」,判定全部留在主脚本。通用件(计数、IPC、条件 id、清 chip)从
// carry-accept-lib.mjs 直接复用,这里只放角色/建议/DOM 新增的那部分。
import { execFileSync } from 'node:child_process';
import {
  all, counts, fmt, get, ipc, condIds, queryCount, clearChips, pressEsc, sleep, waitFor, requireApp,
  noteIdOf, tagIdOf, DB_PATH, EMPTY, openTagMenu, timeQuery, xlsxContentDigest,
} from './carry-accept-lib.mjs';

export {
  all, counts, fmt, get, ipc, condIds, queryCount, clearChips, pressEsc, sleep, waitFor, requireApp,
  noteIdOf, tagIdOf, DB_PATH, openTagMenu, timeQuery, xlsxContentDigest,
};

/** 角色条件(角色天然含子级并叠加携带,没有仅本级开关) */
export const roleCond = (path) => ({ ...EMPTY, roles: [{ path }] });
/** 排除角色条件 */
export const excludeRoleCond = (path) => ({ ...EMPTY, excludeRoles: [{ path }] });
export const tagCond = (path) => ({ ...EMPTY, tags: [{ path, includeChildren: true }] });

// --- 库读数(只读;真实库不动写) ---
export const roleRows = () => get('SELECT COUNT(*) n FROM roles').n;
export const claimRows = () => get('SELECT COUNT(*) n FROM tag_roles').n;
export const claimRoleIds = (tagId) =>
  all('SELECT role_id FROM tag_roles WHERE tag_id=?1 ORDER BY role_id', tagId).map((r) => r.role_id);
export const roleIdOfPath = (path) =>
  get('SELECT r.id FROM roles r JOIN tags t ON t.id=r.tag_id WHERE t.path=?1', path)?.id ?? null;
export const isRoleTag = (tagId) =>
  get('SELECT COUNT(*) n FROM roles WHERE tag_id=?1', tagId).n === 1;
export const claimRowsToRole = (roleId) =>
  get('SELECT COUNT(*) n FROM tag_roles WHERE role_id=?1', roleId).n;

// --- 夹具(一律 角色测试 前缀,自建自删) ---
const NS = '角色测试';
export const FIX = {
  NS,
  A: `${NS}甲`, AS: `${NS}甲/子`, B: `${NS}乙`, C: `${NS}丙`, E: `${NS}戊`, F: `${NS}己`,
  R1: `${NS}/国籍`, R2: `${NS}/所在`, R3: `${NS}/产地`, BASE: `${NS}基准`, CITY: `地点/${NS}城市`,
};
/** 夹具笔记(标题, 标签):每条标签各带一条笔记;角色/基准标签也不例外 */
export const FIXTURE_NOTES = [
  [`${NS}甲笔记`, FIX.A], [`${NS}甲子笔记`, FIX.AS], [`${NS}乙笔记`, FIX.B], [`${NS}丙笔记`, FIX.C],
  [`${NS}国籍标签`, FIX.R1], [`${NS}所在标签`, FIX.R2], [`${NS}产地标签`, FIX.R3], [`${NS}戊标签`, FIX.E],
  [`${NS}城市笔记`, FIX.CITY], [`${NS}基准一`, FIX.BASE], [`${NS}基准二`, FIX.BASE], [`${NS}基准三`, FIX.BASE],
];
/** 走真实保存路径建夹具笔记 */
export async function raiseRoleFixtures(call) {
  for (const [title, tag] of FIXTURE_NOTES) await call('save_input_note', { content: `${title}\n#${tag}` });
}
export const fixtureNoteIds = () =>
  all("SELECT id FROM notes WHERE content LIKE '角色测试%' ORDER BY id").map((r) => r.id);
/** 夹具标签:根级 角色测试*,以及建议规则路径下的 地点/…角色测试… */
export const fixtureTagIds = () =>
  all("SELECT id FROM tags WHERE path LIKE '角色测试%' OR path LIKE '地点/%角色测试%' ORDER BY depth DESC")
    .map((r) => r.id);
export async function purgeRoleFixtures(call) {
  for (const id of fixtureNoteIds()) await call('delete_note', { id }).catch(() => null);
  for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
}

// --- DOM 动作 ---
const attr = (name, value) => `[${name}=' + JSON.stringify(${JSON.stringify(value)}) + ']`;
export const clickByLabel = (cdp, label) =>
  cdp.eval(`(() => { const b = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if (!b) return false; b.click(); return true; })()`);
export const clickMenuItem = (cdp, text) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return false; b.click(); return true; })()`);
/** 侧栏某行的角色徽章文本数组(null = 行不在) */
export const badgesOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${attr('data-tag-path', path)}');
    return r ? Array.from(r.querySelectorAll('[data-role-badge]')).map((x) => x.textContent.trim()) : null; })()`);
/** 侧栏某行的原生 title(悬浮卡片 = 角色/携带多行文本) */
export const rowTitleOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${attr('data-tag-path', path)}');
    return r ? r.getAttribute('title') : null; })()`);
/** 侧栏某行的携带小字(开关打开后才有) */
export const rowCarryOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${attr('data-tag-path', path)}');
    return r ? Array.from(r.querySelectorAll('[data-tag-carry]')).map((x) => x.textContent.trim()) : null; })()`);
export const carryCandidatePaths = (cdp) =>
  cdp.eval(`Array.from(document.querySelectorAll('[data-carry-candidate]')).map((b) => b.textContent.trim())`);
/** 条件栏全部 chip 文本 */
export const chipTexts = (cdp) =>
  cdp.eval(`Array.from(document.querySelectorAll('[aria-label="已生效的筛选条件"] > span')).map((s) => s.textContent.trim())`);

/** 打开设置页并切到「标签角色」分区 */
export async function openRoleSettings(cdp) {
  await clickByLabel(cdp, '设置');
  return waitFor(() => cdp.eval(`!!document.querySelector('[data-section-nav="roles"]')`), 20, 200);
}
export const pickRoleSection = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-section-nav="roles"]'); if (!b) return false; b.click(); return true; })()`);
export const backToStream = (cdp) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回信息流');
    if (!b) return false; b.click(); return true; })()`);
/** 设置页「标签树里显示携带」开关的 aria-checked(null = 不在) */
export const carryToggleState = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('button[aria-label="标签树里显示携带"]'); return b ? b.getAttribute('aria-checked') : null; })()`);

/** 确认应用跑在 dev 构建上(命令行含 0-cargo-target);打印实际命令行,不打一处含糊 */
export function assertDevBuild() {
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'app-lifelog|LifeLog' } | ForEach-Object { $_.CommandLine }";
  let lines = [];
  try {
    lines = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { /* 取不到就当没确认 */ }
  console.log('INFO 进程命令行: ' + fmt(lines));
  return lines.some((l) => l.includes('0-cargo-target'));
}

// --- 建议面板 ---
export const suggestionRowText = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('[data-role-row=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    return r ? r.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
/** 按建议角色筛选(native select:原型 setter + change) */
export const filterSuggestionsByRole = (cdp, name) =>
  cdp.eval(`(() => { const s = document.querySelector('select[aria-label="按建议角色筛选"]'); if (!s) return false;
    const o = Array.from(s.options).find((x) => x.textContent.trim() === ${JSON.stringify(name)}); if (!o) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value);
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
/** 找到某条建议(必要时翻页),找到即返回该行文本 */
export async function findSuggestion(cdp, path, maxPages = 12) {
  for (let i = 0; i < maxPages; i++) {
    const text = await suggestionRowText(cdp, path);
    if (text) return text;
    const more = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === '下一页' && !x.disabled);
      if (!b) return false; b.click(); return true; })()`);
    if (!more) return null;
    await sleep(300);
  }
  return null;
}
/** 勾选某条建议的复选框 */
export const checkSuggestion = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('[data-role-row=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    const cb = r?.querySelector('input[type=checkbox]'); if (!cb) return false; cb.click(); return true; })()`);

/** 打开某标签的「携带…」面板、敲查询串、读候选路径、Esc 关闭(机械动作,判定在调用方) */
export async function readCarryCandidates(cdp, tagPath, query) {
  await openTagMenu(cdp, tagPath);
  await waitFor(() => clickMenuItem(cdp, '携带…'), 8, 200);
  await waitFor(() => cdp.eval(`!!document.querySelector('[aria-label="添加携带标签"]')`), 10, 150);
  await cdp.eval(`(() => { const i = document.querySelector('[aria-label="添加携带标签"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${JSON.stringify(query)});
    i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
  await sleep(300);
  const paths = await carryCandidatePaths(cdp);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  return paths;
}

/** 设置页开关往返:开→读树行携带→关→再读(回各步读数) */
export async function carryToggleRoundTrip(cdp, rowPath) {
  await openRoleSettings(cdp);
  await pickRoleSection(cdp);
  const off = await waitFor(() => carryToggleState(cdp), 20, 200);
  await clickByLabel(cdp, '标签树里显示携带');
  const on = await waitFor(() => cdp.eval(`document.querySelector('button[aria-label="标签树里显示携带"]')?.getAttribute('aria-checked') === 'true'`), 10, 200);
  await sleep(400);
  const carryOn = await rowCarryOf(cdp, rowPath);
  await clickByLabel(cdp, '标签树里显示携带');
  await waitFor(() => cdp.eval(`document.querySelector('button[aria-label="标签树里显示携带"]')?.getAttribute('aria-checked') === 'false'`), 10, 200);
  await sleep(300);
  return { off, on, carryOn, carryOff: await rowCarryOf(cdp, rowPath) };
}
