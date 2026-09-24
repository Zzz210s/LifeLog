// 统一输入框验收 · 第二批读数(计划 2/3 Task 6):条件栏瘦身 / 排序命令 / 顶栏溢出菜单 / 侧栏筛选标签。
// 为什么单独成文件:主脚本已 196 行(代码文件 200 行红线,用户规则),这批的动作与判定都收在这里,
// 由 dev-unified-input-accept.mjs 在夹具就绪后调用一次,共用同一个 recorder(读数口径不变)。
import { os } from './cdp-os.mjs';
import { sleep, waitFor } from './cdp-lib.mjs';
import { FIXTURE_TAG, SIDEBAR } from './unified-accept-lib.mjs';

const BAR = '[data-testid="condition-bar"]';
const MENU = '[data-testid="topbar-menu"]';
const MORE = '#root button[aria-label="更多操作"]';
const STATUS = '[data-testid="command-status"]';
/** Task 2 搬到 `>`/顶栏菜单的三样动作:条件栏里不该再出现这些按钮文案 */
const BANNED = ['排序', '导出', '添加条件'];
/** 顶栏溢出菜单四条(顺序即用户可见顺序;标题来自命令表,不在组件里重写) */
const MENU_LABELS = ['最新在前', '最早在前', '导出整库', '添加条件'];

const menuOpen = (d) => d.ev(`!!document.querySelector('${MENU}')`);
const statusText = (d) => d.ev(`document.querySelector('${STATUS}')?.textContent ?? null`);
const firstNoteId = (d) => d.ev(`document.querySelector('[data-note-body]')?.getAttribute('data-note-body') ?? null`);
const menuItems = (d) =>
  d.ev(`Array.from(document.querySelectorAll('${MENU} button')).map((b) => ({ label: b.textContent.trim(),
    role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'),
    check: !!b.querySelector('[data-testid="topbar-menu-check"]') }))`);

/** 点顶栏 `⋯`(程序化 click:菜单是 DOM 浮层,不进系统拖动回路) */
const clickMore = async (d) => {
  await d.ev(`document.querySelector('${MORE}').click()`);
  await sleep(320);
};

/** 点溢出菜单里文案完全匹配的一条 */
const clickMenuItem = async (d, label) => {
  const hit = await d.ev(`(() => {
    const b = [...document.querySelectorAll('${MENU} button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(420);
  return hit === true;
};

/** 在 `>` 里跑一条命令:候选首行 id 回传,便于核对确实落在了目标命令上 */
const runCommand = async (d, query) => {
  await d.clearBox();
  await d.type('>' + query);
  const rows = await waitFor(async () => { const rs = await d.rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  await d.enter();
  await sleep(900);
  return rows ?? [];
};

/** 开 `>` 列全部命令,读两条排序命令的勾选态(读完 Esc 收起) */
const sortChecked = async (d) => {
  await d.clearBox();
  await d.type('>');
  const rows = (await waitFor(async () => { const rs = await d.rows(); return rs.length > 0 ? rs : null; }, 12, 250)) ?? [];
  await d.esc();
  await sleep(220);
  const on = (id) => rows.find((x) => x.id === id)?.checked === true;
  return { newest: on('sort.newest'), oldest: on('sort.oldest') };
};

/** ⑪ 条件栏只剩 chips + 摘要:用 `#标签` 造出一个 chip 与一句摘要,再数栏内按钮文案 */
async function conditionBarOnlyChips(d, r) {
  await d.clearChips();
  await d.clearBox();
  await d.esc();
  await sleep(250);
  await d.type(`#${FIXTURE_TAG}`);
  await waitFor(async () => ((await d.rows()).length > 0 ? true : null), 12, 250);
  await d.enter();
  await sleep(800);
  const chipCount = (await d.chips()).length;
  const summary = await d.ev(`document.querySelector('${BAR} [data-testid="condition-bar-summary"]')?.textContent ?? null`);
  const buttons = await d.ev(`Array.from(document.querySelectorAll('${BAR} button')).map((b) => b.textContent.trim())`);
  const banned = buttons.filter((t) => BANNED.some((w) => t.includes(w)));
  r.record('⑪ 条件栏只剩 chips + 摘要', chipCount === 1 && summary !== null && banned.length === 0,
    `chip ${chipCount} 个;摘要="${summary}";栏内按钮 ${JSON.stringify(buttons)};命中搬到别处的文案 ${JSON.stringify(banned)}`);
}

/** ⑫ `>` 排序命令:勾选态随 conditions.sort 翻转,且流首条 id 真变 */
async function sortCommands(d, r) {
  await d.clearChips();
  await d.clearBox();
  await runCommand(d, '最新在前'); // 先复位(上一次跑可能停在最早在前)
  const beforeFirst = await waitFor(async () => { const v = await firstNoteId(d); return v === null ? null : v; }, 12, 300);
  const before = { ...(await sortChecked(d)), first: beforeFirst };
  const runRows = await runCommand(d, '最早在前');
  const top = runRows[0]?.id ?? null;
  const afterFirst = await waitFor(async () => {
    const v = await firstNoteId(d);
    return v !== null && v !== beforeFirst ? v : null;
  }, 14, 300);
  const after = { ...(await sortChecked(d)), first: afterFirst };
  await runCommand(d, '最新在前'); // 复位,别把排序留给后面的读数
  const restored = await waitFor(async () => { const v = await firstNoteId(d); return v === beforeFirst ? v : null; }, 14, 300);
  r.record('⑫ `>` 排序命令(勾选态 + 流顺序)',
    before.newest === true && before.oldest === false && top === 'sort.oldest' &&
      after.newest === false && after.oldest === true && afterFirst !== null && afterFirst !== beforeFirst && restored === beforeFirst,
    `复位态 最新=${before.newest}/最早=${before.oldest}(首条 ${beforeFirst});「最早在前」候选首行 ${top};` +
      `翻转后 最新=${after.newest}/最早=${after.oldest}(首条 ${afterFirst});复位后首条 ${restored}`);
}

/** ⑬ 顶栏 `⋯` 菜单:四条条目与勾选态 -> 点「添加条件」关菜单并开出条件栏菜单 */
async function topBarMenu(d, r) {
  await d.esc();
  await sleep(250);
  await clickMore(d);
  await waitFor(async () => ((await menuOpen(d)) ? true : null), 8, 200);
  const items = await menuItems(d);
  const shape = items.length === 4 && items.map((i) => i.label).join('|') === MENU_LABELS.join('|') &&
    items[0].role === 'menuitemradio' && items[0].checked === 'true' && items[0].check === true &&
    items[1].role === 'menuitemradio' && items[1].checked === 'false' && items[1].check === false &&
    items[2].role === 'menuitem' && items[3].role === 'menuitem';
  const clicked = await clickMenuItem(d, MENU_LABELS[3]);
  const closed = !(await menuOpen(d));
  const addOpen = await waitFor(async () => ((await d.ev(`!!document.querySelector('${BAR} [role="menu"]')`)) ? true : null), 10, 250);
  const addItems = await d.ev(`Array.from(document.querySelectorAll('${BAR} [role="menu"] [role="menuitem"]')).map((b) => b.textContent.trim())`);
  r.record('⑬ 顶栏 `⋯` 菜单', shape && clicked && closed && addOpen === true,
    `条目 ${JSON.stringify(items)};点「${MENU_LABELS[3]}」命中=${clicked};溢出菜单已关=${closed};` +
      `条件栏菜单=${addOpen === true ? JSON.stringify(addItems) : '未出现'}`);
  await d.esc();
  await sleep(250);
}

/** ⑭ 顶栏「导出整库」:菜单关 + 状态条起 -> 原生另存对话框弹出后取消,状态条复位 */
async function topBarExport(d, r) {
  await d.esc();
  await sleep(250);
  await clickMore(d);
  const clicked = await clickMenuItem(d, '导出整库');
  const closed = !(await menuOpen(d));
  const pill = await waitFor(async () => (await statusText(d)) ?? null, 10, 250);
  const pid = os.pidOf();
  const dlg = await waitFor(async () => os.wins(pid).find((w) => w.cls === '#32770' && w.visible) ?? null, 16, 300);
  const cancel = dlg ? os.closeDialog(pid) : { found: false, closed: false };
  const gone = await waitFor(async () => (os.wins(pid).some((w) => w.cls === '#32770' && w.visible) ? null : true), 14, 300);
  const pillGone = await waitFor(async () => ((await statusText(d)) === null ? true : null), 14, 300);
  r.record('⑭ 顶栏「导出整库」',
    clicked && closed && (pill ?? '').includes('导出整库') && dlg !== null && cancel.closed === true && gone === true && pillGone === true,
    `点条目命中=${clicked};溢出菜单已关=${closed};状态条="${pill}";原生另存对话框(类 #32770)="${dlg ? dlg.title : '未出现'}";` +
      `取消读数 ${JSON.stringify(cancel)};对话框已消失=${gone};状态条已复位=${pillGone}`);
}

/** ⑮ 侧栏:主窗 aside 内没有输入框;点「筛选标签」把 `#` 交给统一输入框并抢回焦点 */
async function sidebarPrefill(d, r) {
  await d.clearBox();
  await d.esc();
  await sleep(250);
  const inputs = await d.ev(`document.querySelectorAll('${SIDEBAR} input, ${SIDEBAR} textarea').length`);
  const clicked = await d.ev(`(() => {
    const b = document.querySelector('${SIDEBAR} button[aria-label="筛选标签"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(400);
  const value = await d.boxValue();
  const focused = await d.boxFocused();
  await d.clearBox();
  await d.esc();
  r.record('⑮ 侧栏无输入框 + 筛选标签预填 `#`',
    inputs === 0 && clicked === true && String(value).startsWith('#') && focused === true,
    `侧栏内 input/textarea ${inputs} 个;点「筛选标签」命中=${clicked};输入框值="${value}";焦点在框=${focused}`);
}

/** 第二批 5 条读数的入口(顺序即依赖:先造 chip 再动排序,最后是顶栏菜单与侧栏) */
export async function phaseB(d, r) {
  await conditionBarOnlyChips(d, r);
  await sortCommands(d, r);
  await topBarMenu(d, r);
  await topBarExport(d, r);
  await sidebarPrefill(d, r);
}
