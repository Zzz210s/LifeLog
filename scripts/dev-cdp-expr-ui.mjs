// 表达式验收(scripts/dev-cdp-accept-expr.mjs)的页面侧动作库:
// 把 DOM 交互与读数集中注入成 window.__X,由 Cdp.eval 调用。
// React 受控输入必须用原生 setter + input 事件,否则 onChange 不触发。
// 本文件只含要在页面里跑的代码字符串,不在 Node 侧执行。
export const HELPERS = `(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const byText = (t, s) => all(s || 'button').find((e) => e.textContent.trim() === t);
  const dlg = (name) => q('[role=dialog][aria-label="' + name + '"]');
  const X = {
    // click / clickIn 对 disabled 按钮返回 false(click() 本身不会派发事件),便于断言“被拒”
    click: (t, s) => { const e = byText(t, s || 'button'); if (!e || e.disabled) return false; e.click(); return true; },
    clickIn: (name, t) => { const d = dlg(name); const e = d && byText(t, '[role=dialog][aria-label="' + name + '"] button'); if (!e || e.disabled) return false; e.click(); return true; },
    // 表达式对话框「确定」当前是否禁用(非法表达式/校验中应为 true)
    confirmDisabled: () => { const d = dlg('表达式'); const b = d && byText('确定', '[role=dialog][aria-label="表达式"] button'); return b ? !!b.disabled : null; },
    // 打开表达式编辑对话框(菜单是开/关切换,失手时重试)
    openExpr: async () => {
      for (let k = 0; k < 3 && !dlg('表达式'); k++) {
        X.click('添加条件');
        await pause(150);
        X.click('表达式(高级)', '[role=menuitem]');
        await pause(150);
      }
      return !!dlg('表达式');
    },
    fillExpr: (v) => { const d = dlg('表达式'); if (!d) return false; set(d.querySelector('textarea'), v); return true; },
    exprValue: () => { const d = dlg('表达式'); return d ? d.querySelector('textarea').value : null; },
    // 校验状态:kind = pending | ok | err;danger 是红框类;sel 是光标区间
    status: () => {
      const d = dlg('表达式');
      if (!d) return null;
      const span = d.querySelector('p[aria-live=polite] span');
      const ta = d.querySelector('textarea');
      if (!span) return { kind: 'none', text: '', danger: false, sel: null };
      return {
        kind: span.className.includes('text-success') ? 'ok' : span.className.includes('text-danger') ? 'err' : 'pending',
        text: span.textContent,
        danger: ta.className.includes('border-danger'),
        sel: [ta.selectionStart, ta.selectionEnd],
      };
    },
    chips: () => all('[aria-label="已生效的筛选条件"] > span').map((s) => ({
      label: s.textContent.replace('×', '').trim(),
      title: s.getAttribute('title'),
    })),
    chipArea: () => !!q('[aria-label="已生效的筛选条件"]'),
    clickChipButton: (prefix) => {
      const b = all('[aria-label="已生效的筛选条件"] button').find((e) => (e.getAttribute('aria-label') || '').startsWith(prefix));
      if (!b) return false;
      b.click();
      return true;
    },
    summary: () => {
      const p = all('p').find((e) => e.className.includes('truncate') && e.textContent.includes('表达式:'));
      return p ? { text: p.textContent.trim(), title: p.getAttribute('title') } : null;
    },
    texts: () => all('li .md-body').map((e) => e.textContent.trim()),
    esc: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  };
  window.__X = X;
  return true;
})()`;
