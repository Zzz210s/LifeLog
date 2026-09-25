// 视觉令牌审计的第 18 条读数:顶栏溢出菜单(`⋯`,统一输入框 2/3 Task 3 新增的浮层)。
// 为什么单独成文件:审计主脚本 197 行、audit-visual-scan.mjs 198 行,都已贴住 200 行红线。
//
// 这条读数接替计划 1/3 Task 7 删掉的「命令面板浮层」读数(浮层外壳已不存在):
// 多页筛选删除后,主窗只剩**一个** `aria-haspopup=menu` 浮层(顶栏 `⋯`;它由主脚本的
// MENU_SCAN_JS 覆盖),这条负责逐条核对条目档位(4px 圆角 + 13px 字号,V5 收口口径)。
import { sleep, waitFor } from './cdp-lib.mjs';

const MENU = '[data-testid="topbar-menu"]';
const MORE = '#root button[aria-label="更多操作"]';
const EXPECT = ['最新在前', '最早在前', '导出整库', '添加条件'];

/** 开菜单 -> 读容器与四条条目的计算样式与状态 -> 再点击 `⋯` 关回去 */
const SCAN_JS = `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const cs = (el) => getComputedStyle(el);
  const btn = document.querySelector('${MORE}');
  if (!btn) return { ok: false, why: '没有顶栏 ⋯ 按钮' };
  btn.click();
  await pause(350);
  const menu = document.querySelector('${MENU}');
  if (!menu) return { ok: false, why: '点开后没有 [data-testid=topbar-menu]' };
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

/** 读一条「顶栏溢出菜单」读数:容器 12px + 阴影、四条条目、条目 4px / 13px、关掉后不留浮层 */
export async function recordTopBarMenu(js, r) {
  const m = await js(SCAN_JS);
  const closed = await waitFor(async () => ((await js(`!!document.querySelector('${MENU}')`)) ? null : true), 6, 200);
  const items = m?.items ?? [];
  const itemsOk = items.length === EXPECT.length && items.map((i) => i.label).join('|') === EXPECT.join('|') &&
    items.every((i) => i.radius === '4px' && i.fontSize === '13px') &&
    items[0].role === 'menuitemradio' && items[0].checked === 'true' &&
    items[1].role === 'menuitemradio' && items[2].role === 'menuitem' && items[3].role === 'menuitem';
  r.record('顶栏溢出菜单 = 12px + 阴影,四条条目 4px / 13px',
    m?.ok === true && m.radius === '12px' && m.shadow !== 'none' && m.zIndex !== 'auto' && itemsOk && closed === true,
    `容器 ${m?.radius}/${m?.shadow === 'none' ? '无阴影' : '有阴影'}/z=${m?.zIndex};尺寸 ${JSON.stringify(m?.rect)};` +
      `条目 ${JSON.stringify(items.map((i) => [i.label, i.role, i.checked, i.radius, i.fontSize]))};点两次 「⋯」 后已关=${closed}`);
  await sleep(200);
}
