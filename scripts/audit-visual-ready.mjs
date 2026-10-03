/**
 * 视觉令牌审计的**前置条件**(2026-10-01 抽出):把应用带回已知状态再扫描。
 *
 * 背景:门禁跑在用户正在用的那个实例上,之前直接扫当前画面 —— 应用刚启动(卡片未渲染)、
 * 停在设置/关系图、或带着筛选条件时,结果会随机红或随机跳(实测:同代码两次 pnpm verify 一红一绿)。
 * 口径:非信息流就退出该视图 → 清空筛选 chip → 等可见卡片到齐(有界等待),再交给扫描。
 */
export const READY_JS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 1) 回信息流。两条退出通道,顺序固定:
  //    a) 关系图 —— Esc;b) 设置页 —— 顶栏那个「返回信息流」按钮(设置页**没有** testid,
  //       也没有 Esc 处理;2026-10-03 实测:光靠 testid + Esc 会把停在设置页的应用当成信息流,
  //       后续读数全读到 0px 高的隐藏卡片)。
  for (let i = 0; i < 4; i++) {
    const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '返回信息流');
    if (back) { back.click(); await sleep(500); continue; }
    if (document.querySelector('[data-testid="graph-view"]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);
      continue;
    }
    break;
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
