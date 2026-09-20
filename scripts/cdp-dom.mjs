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

  /** 整页重载并等到主窗外壳(设置齿轮)与侧栏标签行渲染完成(清掉上一次运行/手工调试残留的界面状态) */
  const reloadPage = async () => {
    await evalIn('location.reload()');
    await sleep(2500);
    await waitFor(() => evalIn(`!!document.querySelector('button[aria-label="设置"]') && !!document.querySelector('[data-tag-path]')`));
  };

  return { evalIn, setInput, dlgSetInput, chips, clearChips, clickText, dlgClick, dialogLabels, menuPick, reloadPage };
}
