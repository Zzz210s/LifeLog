// 视觉令牌审计的第 18 条读数:条件栏「添加条件」浮层(主面板十项)。
// 2026-10-07 换读数对象:顶栏 `⋯` 溢出菜单已按盘点报告删除,主窗信息流视图下带 aria-haspopup=menu 的
// 常驻浮层只剩条件栏的「排序」与「添加条件」(后者条目多、能逐条核对档位),所以这里接替旧读数。
// 条目顺序/文案与 src/main-window/filter/AddConditionMenu.tsx 主面板一字对应,改了它这里要同步。
import { sleep, waitFor } from './cdp-lib.mjs';

const MENU = '[data-testid="add-condition-menu"]';
const TRIGGER = '#root button[aria-label="添加条件"]';
const EXPECT = ['标签', '排除标签', '关系', '排除关系', '有无标签', '树内 / 单行', '条件组', '排序', '分组', '表达式(高级)'];

/** 开菜单 -> 读容器与十条条目的计算样式与状态 -> 再点击触发按钮关回去 */
const SCAN_JS = `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const cs = (el) => getComputedStyle(el);
  const btn = document.querySelector('${TRIGGER}');
  if (!btn) return { ok: false, why: '没有条件栏「添加条件」按钮' };
  btn.click();
  await pause(350);
  const menu = document.querySelector('${MENU}');
  if (!menu) return { ok: false, why: '点开后没有 [data-testid=add-condition-menu]' };
  // 先快照计算样式:关掉菜单后元素卸载,live 的 CSSStyleDeclaration 会读成空串
  const box = menu.getBoundingClientRect();
  const style = { radius: cs(menu).borderRadius, shadow: cs(menu).boxShadow, zIndex: cs(menu).zIndex };
  const items = [...menu.querySelectorAll('button')].map((b) => ({ label: b.textContent.trim(),
    role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'),
    radius: cs(b).borderRadius, fontSize: cs(b).fontSize }));
  btn.click();
  await pause(250);
  return { ok: true, ...style, rect: { w: Math.round(box.width), h: Math.round(box.height) }, items };
})()`;

/** 读一条「条件栏添加条件浮层」读数:容器 12px + 阴影、十条条目、条目 4px / 13px、关掉后不留浮层 */
export async function recordTopBarMenu(js, r) {
  const m = await js(SCAN_JS);
  const closed = await waitFor(async () => ((await js(`!!document.querySelector('${MENU}')`)) ? null : true), 6, 200);
  const items = m?.items ?? [];
  const itemsOk = items.length === EXPECT.length && items.map((i) => i.label).join('|') === EXPECT.join('|') &&
    items.every((i) => i.radius === '4px' && i.fontSize === '13px' &&
      i.role === 'menuitem' && i.checked === null);
  r.record('条件栏添加条件浮层 = 12px + 阴影,十条条目 4px / 13px',
    m?.ok === true && m.radius === '12px' && m.shadow !== 'none' && m.zIndex !== 'auto' && itemsOk && closed === true,
    `容器 ${m?.radius}/${m?.shadow === 'none' ? '无阴影' : '有阴影'}/z=${m?.zIndex};尺寸 ${JSON.stringify(m?.rect)};` +
      `条目 ${JSON.stringify(items.map((i) => [i.label, i.role, i.checked, i.radius, i.fontSize]))};点两次后已关=${closed}`);
  await sleep(200);
}
