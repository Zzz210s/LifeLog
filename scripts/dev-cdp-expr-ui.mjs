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
    // 顶栏「保存为视图」:只落库 + 顶栏提示,不通知侧栏重载(侧栏需等下一次数据变更)
    saveView: async (title) => {
      for (let k = 0; k < 3 && !dlg('保存为视图'); k++) {
        X.click('保存为视图');
        await pause(150);
      }
      return X.fillSaveView(title);
    },
    // 侧栏「+」入口(aria-label=新建视图):onSaved 会立刻重载视图列表,行会即时出现
    saveViewFromSidebar: async (title) => {
      for (let k = 0; k < 3 && !dlg('保存为视图'); k++) {
        const b = q('button[aria-label="新建视图"]');
        if (!b || b.disabled) return false;
        b.click();
        await pause(150);
      }
      return X.fillSaveView(title);
    },
    fillSaveView: async (title) => {
      const d = dlg('保存为视图');
      const i = d && d.querySelector('input');
      if (!i) return false;
      set(i, title);
      await pause(60);
      return X.clickIn('保存为视图', '保存');
    },
    viewRow: (id) => {
      const r = q('[data-view-id="' + id + '"]');
      if (!r) return null;
      const dot = r.querySelector('[data-broken-paths]');
      return {
        id: r.getAttribute('data-view-id'),
        text: r.textContent.trim(),
        broken: dot ? { paths: dot.getAttribute('data-broken-paths'), title: dot.getAttribute('title') } : null,
      };
    },
    applyView: (id) => { const r = q('[data-view-id="' + id + '"]'); if (!r) return false; r.click(); return true; },
    // 点视图行应用条件,直到 chips 里出现 needle(视图列表重载与点击有竞态,需重试)
    applyViewFor: async (id, needle) => {
      for (let k = 0; k < 5; k++) {
        X.applyView(id);
        await pause(400);
        const c = X.chips();
        if (c.some((y) => y.label.includes(needle))) return c;
      }
      return null;
    },
    tagRow: (p) => !!q('[data-tag-path="' + p + '"]'),
    ensureTag: async (p) => {
      const segs = p.split('/');
      for (let i = 1; i <= segs.length; i++) {
        const cur = segs.slice(0, i).join('/');
        for (let k = 0; k < 3 && !X.tagRow(cur); k++) {
          const svg = q('[data-tag-path="' + segs.slice(0, i - 1).join('/') + '"] svg');
          if (!svg) return false;
          svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await pause(150);
        }
        if (!X.tagRow(cur)) return false;
      }
      return true;
    },
    renameTag: async (p, name) => {
      X.esc();
      await pause(120);
      const r = q('[data-tag-path="' + p + '"]');
      if (!r) return false;
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
      await pause(150);
      X.click('重命名', '[role=menuitem]');
      await pause(150);
      const i = q('input[aria-label="新标签名"]');
      if (!i) return false;
      set(i, name);
      await pause(60);
      return X.click('确定');
    },
    deleteTag: async (p) => {
      X.esc();
      await pause(120);
      const r = q('[data-tag-path="' + p + '"]');
      if (!r) return false;
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
      await pause(150);
      X.click('删除', '[role=menuitem]');
      for (let k = 0; k < 24; k++) {
        await pause(150);
        const b = byText('确认删除');
        if (b && !b.disabled) { b.click(); return true; }
      }
      return false;
    },
    esc: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  };
  window.__X = X;
  return true;
})()`;
