// 小视口下弹层裁剪的读数节模块(由 dev-scroll-interaction.mjs 调用,结果并入 readings/interaction.json)。
// 测两个弹层(表达式 / 添加标签 / 排除标签)在 400x300 视口下:面板高是否超出视口、overflow-y 是否可滚、
// 滚到底后「确定/取消」是否都落在视口内。用 CDP Emulation 改**页面级视口**(非真实窗口尺寸),
// 等价于把窗口改矮:根滚动已关(R1),弹层唯一可达路径是自身滚动。
// 输入:cdp(主窗连接)、R(结果对象,就地追加);返回 R。
import { js, sleep } from './dev-scroll-lib.mjs';

const callText = (cdp, scope, text) =>
  js(cdp, `(() => {
    const root = ${scope};
    const b = root && Array.from(root.querySelectorAll('button'))
      .find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`);

/** 弹层读数:面板框、max-height/overflow、可滚量与关键按钮是否在视口内 */
const read = (cdp) =>
  js(cdp, `(() => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((d) => ['表达式', '添加标签', '排除标签'].includes(d.getAttribute('aria-label')));
    if (!dlg) return { 无弹层: true };
    const cs = getComputedStyle(dlg);
    const r = dlg.getBoundingClientRect();
    const 按钮 = Array.from(dlg.querySelectorAll('button'))
      .filter((b) => ['确定', '取消', '清空'].includes(b.textContent.trim()) || b.getAttribute('aria-label') === '关闭')
      .map((b) => {
        const br = b.getBoundingClientRect();
        return { 文本: b.textContent.trim() || b.getAttribute('aria-label'),
          视口top: Math.round(br.top), 视口bottom: Math.round(br.bottom),
          在视口内: br.top >= -1 && br.bottom <= window.innerHeight + 1 };
      });
    return {
      标题: dlg.getAttribute('aria-label'), 视口: { w: window.innerWidth, h: window.innerHeight },
      面板: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      maxHeight: cs.maxHeight, overflowY: cs.overflowY,
      可滚量: dlg.scrollHeight - dlg.clientHeight, 可滚: dlg.scrollHeight > dlg.clientHeight + 1,
      scrollTop: Math.round(dlg.scrollTop), 按钮, 根top: Math.round(document.scrollingElement.scrollTop),
    };
  })()`);

/**
 * 打开「添加条件」菜单:条件栏的触发按钮已随统一输入框 2/3 Task 2 搬走 ——
 * 旧写法是点按钮正文「添加条件」,现在改走统一输入框的「>添加条件」命令(菜单项仍按 [role=menuitem] 点)。
 */
const openAddMenu = (cdp) =>
  js(cdp, `(async () => {
    const box = document.querySelector('[data-testid="unified-input"]');
    if (!box) return false;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const setValue = (v) => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, v);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const rows = () => [...document.querySelectorAll('[data-testid="unified-dropdown"] li[role=option]')]
      .filter((li) => li.textContent.includes('添加条件'));
    for (let k = 0; k < 3; k++) {
      setValue('>添加条件');
      for (let i = 0; i < 12 && rows().length === 0; i++) await pause(250);
      if (rows().length === 0) continue;
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await pause(700);
      setValue('');
      await pause(200);
      if (document.querySelector('[role=menuitem]')) return true;
    }
    return false;
  })()`);

const open = async (cdp, item) => {
  // 先收掉残留弹层(上一轮关不掉时,下面的「添加条件」会被遮罩吃掉)
  if (await js(cdp, `!!document.querySelector('[role="dialog"]')`)) await close(cdp);
  await openAddMenu(cdp);
  await sleep(400);
  await js(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('[role="menuitem"]')).find((x) => x.textContent.trim() === ${JSON.stringify(item)});
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(700);
};

/** 关闭弹层:表达式弹层点「取消」,标签弹层点「关闭」(× 的 aria-label) —— 两者按钮集不同 */
async function close(cdp) {
  if (await callText(cdp, `document.querySelector('[role="dialog"]')`, '取消')) return true;
  return callText(cdp, `document.querySelector('[role="dialog"]')`, '关闭');
}

export async function dialogSections(R, cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1.25, mobile: false });
  await sleep(600);
  R.A3小视口弹层 = { 视口: await js(cdp, `({ w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio })`) };
  for (const 项 of ['表达式(高级)', '标签', '排除标签']) {
    await open(cdp, 项);
    const 初 = await read(cdp);
    await js(cdp, `(() => { const d = document.querySelector('[role="dialog"]'); if (d) d.scrollTop = d.scrollHeight; return true; })()`);
    await sleep(300);
    R.A3小视口弹层[项] = { 初, 滚到底后: await read(cdp), 关闭: await close(cdp) };
    await sleep(500);
  }
  R.A3小视口弹层.收尾 = { 弹层残留: await js(cdp, `!!document.querySelector('[role="dialog"]')`) };
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(500);
  return R;
}
