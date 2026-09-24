// dev 验收脚本共用的 DOM 操作件(React 受控输入与对话框交互)。
// 坑位记录:受控 input/textarea 必须用原型上的 value setter + 派发 input 事件,否则 React 的 onChange 不触发;
// 同名输入框(如设置页与对话框里的输入)必须按对话框作用域区分,故提供 dlgSetInput。
import { sleep, waitFor } from './cdp-lib.mjs';

const SETTER = `const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;`;

export function bindDom(cdp) {
  const evalIn = (expr) => cdp.eval(expr);

  /** 设置指定 aria-label 的受控输入框的值(React 受控输入的标准做法) */
  const setInput = (label, value, withChange = false) =>
    evalIn(`(() => {
      const input = document.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!input) return false;
      ${SETTER}
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      ${withChange ? "input.dispatchEvent(new Event('change', { bubbles: true }));" : ''}
      return true;
    })()`);

  /** 对话框内的输入框(同名输入框在页面其他地方也存在时按对话框作用域定位) */
  const dlgSetInput = (dlgLabel, label, value) =>
    evalIn(`(() => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.getAttribute('aria-label') === ${JSON.stringify(dlgLabel)});
      const input = dlg ? dlg.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']') : null;
      if (!input) return false;
      ${SETTER}
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  /** 当前生效的条件 chip 文案(去掉「移除条件 」前缀) */
  const chips = () => evalIn(`Array.from(document.querySelectorAll('[aria-label^="移除条件"]')).map((b) => b.getAttribute('aria-label').replace('移除条件 ', ''))`);

  /** 逐个移除全部条件 chip,直到没有为止 */
  const clearChips = async () => {
    for (let i = 0; i < 10; i++) {
      const more = await evalIn(`(() => { const b = document.querySelector('[aria-label^="移除条件"]'); if (b) { b.click(); return 1; } return 0; })()`);
      if (!more) break;
      await sleep(250);
    }
    await sleep(400);
  };

  /** 按按钮正文点击(全页面范围内) */
  const clickText = (text) =>
    evalIn(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  /** 在指定 aria-label 的对话框内按正文/aria-label 点按钮(多对话框并存时避免点错) */
  const dlgClick = (dlgLabel, text) =>
    evalIn(`(() => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.getAttribute('aria-label') === ${JSON.stringify(dlgLabel)});
      if (!dlg) return false;
      const b = Array.from(dlg.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  const dialogLabels = () => evalIn(`Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute('aria-label'))`);

  /** 点「添加条件」菜单里的菜单项 */
  const menuPick = (text) =>
    evalIn(`(() => {
      const b = Array.from(document.querySelectorAll('[role="menuitem"]')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  /**
   * 把统一输入框设成带前缀的值(`>` 命令 / `/` 关键词筛选 / `#` 标签 / `@` 打开笔记)。
   * 旧筛选栏的关键词输入框已随统一输入框 1/3 删除,关键词筛选的入口就是这里。
   */
  const setBox = (value) =>
    evalIn(`(() => {
      const box = document.querySelector('[data-testid="unified-input"]');
      if (!box) return false;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(value)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  /**
   * 打开「添加条件」菜单:条件栏的触发按钮已随统一输入框 2/3 Task 2 搬走(只剩顶栏 `⋯` 菜单
   * 与这里的 `>添加条件` 命令两条入口);菜单项仍用 menuPick 点,与旧写法一致。
   */
  const openAddCondition = async () => {
    const opened = await evalIn(`(async () => {
      const box = document.querySelector('[data-testid="unified-input"]');
      if (!box) return false;
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const setValue = (v) => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, v);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const rows = () => [...document.querySelectorAll('[data-testid="unified-dropdown"] li[role="option"]')]
        .filter((li) => li.textContent.includes('添加条件'));
      for (let k = 0; k < 3; k++) {
        setValue('>添加条件');
        for (let i = 0; i < 12 && rows().length === 0; i++) await pause(250);
        if (rows().length === 0) continue;
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await pause(700);
        setValue('');
        await pause(200);
        if (document.querySelector('[role="menuitem"]')) return true;
      }
      return false;
    })()`);
    await sleep(200);
    return opened === true;
  };

  /** 点顶栏 `⋯` 溢出菜单里的一条(Task 3:排序 / 导出整库 / 添加条件的鼠标入口) */
  const openTopBarMenu = async (label) => {
    const opened = await evalIn(`(() => {
      const btn = document.querySelector('#root button[aria-label="更多操作"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(320);
    const picked = await evalIn(`(() => {
      const b = [...document.querySelectorAll('[data-testid="topbar-menu"] button')]
        .find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(300);
    return opened === true && picked === true;
  };

  /** 整页重载并等到主窗外壳(设置齿轮)与侧栏标签行渲染完成(清掉上一次运行/手工调试残留的界面状态) */
  const reloadPage = async () => {
    await evalIn('location.reload()');
    await sleep(2500);
    await waitFor(() => evalIn(`!!document.querySelector('button[aria-label="设置"]') && !!document.querySelector('[data-tag-path]')`));
  };

  return { evalIn, setInput, dlgSetInput, chips, clearChips, clickText, dlgClick, dialogLabels, menuPick, reloadPage,
    setBox, openAddCondition, openTopBarMenu };
}
