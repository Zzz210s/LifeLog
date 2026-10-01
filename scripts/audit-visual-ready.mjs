/**
 * 视觉令牌审计的**前置条件**(2026-10-01 抽出):把应用带回已知状态再扫描。
 *
 * 背景:门禁跑在用户正在用的那个实例上,之前直接扫当前画面 —— 应用刚启动(卡片未渲染)、
 * 停在设置/关系图、或带着筛选条件时,结果会随机红或随机跳(实测:同代码两次 pnpm verify 一红一绿)。
 * 口径:非信息流就退出该视图 → 清空筛选 chip → 等可见卡片到齐(有界等待),再交给扫描。
 */
export const READY_JS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 1) 回信息流:关系图与设置页的退出通道都是 Esc
  for (let i = 0; i < 3; i++) {
    if (!document.querySelector('[data-testid="graph-view"]') && !document.querySelector('[data-testid="settings-view"]')) break;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
  }
  // 2) 清空筛选条件(条件栏里的移除按钮)
  for (let i = 0; i < 12; i++) {
    const b = document.querySelector('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]');
    if (!b) break;
    b.click();
    await sleep(320);
  }
  // 3) 等可见卡片到齐(最多 8 秒)
  const vis = (el) => {
    const c = getComputedStyle(el);
    return c.display !== 'none' && c.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  };
  const count = () => [...document.querySelectorAll('#root ul li')].filter((li) => li.querySelector('.md-body') && vis(li)).length;
  for (let i = 0; i < 80; i++) {
    if (count() >= 2) return { cards: count() };
    await sleep(100);
  }
  return { cards: count() };
})()`;
