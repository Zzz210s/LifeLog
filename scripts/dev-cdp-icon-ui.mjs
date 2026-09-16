// 视图图标验收(scripts/dev-cdp-accept-icon.mjs)的页面侧动作库:注入成 window.__X 供 Cdp.eval 调用。
// 覆盖:打开/填写/确认对话框、图标网格点选与回填读取、侧栏行读数(图标名 / svg 类名 / 标题左偏移)、
// 内置三行读数。React 受控输入必须用原生 setter + input 事件,否则 onChange 不触发。
// 本文件只含要在页面里跑的代码字符串,不在 Node 侧执行;避免在模板串里出现反引号。
export const HELPERS = `(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const dlg = (name) => q('[role="dialog"][aria-label="' + name + '"]');
  const dlgBtn = (t) => all('[role="dialog"] button').find((e) => e.textContent.trim() === t);
  const round = (v) => Math.round(v * 100) / 100;
  const X = {
    sidebar: () => !!q('[data-testid="sidebar"]'),
    showSidebar: () => {
      const b = q('button[aria-label="显示侧栏"]');
      if (!b) return false;
      b.click();
      return true;
    },
    // 顶栏筛选栏的「保存为视图」入口
    openSave: () => {
      const b = all('button').find((e) => e.textContent.trim() === '保存为视图');
      if (!b) return false;
      b.click();
      return true;
    },
    dialogOpen: (name) => !!dlg(name),
    setTitle: (v) => {
      const d = dlg('保存为视图') || dlg('编辑视图');
      const i = d && d.querySelector('input[aria-label="视图标题"]');
      if (!i) return false;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    titleValue: () => {
      const i = q('[role="dialog"] input[aria-label="视图标题"]');
      return i ? i.value : null;
    },
    // 图标网格:点某一项(名字或「无图标」);返回是否点到
    pickIcon: (name) => {
      const b = q('[role="radiogroup"][aria-label="图标"] [role="radio"][aria-label="' + name + '"]');
      if (!b) return false;
      b.click();
      return true;
    },
    // 网格当前选中项的名字(null = 没有选中项;「无图标」返回 '无图标' 文案)
    pickedIcon: () => {
      const b = all('[role="radiogroup"][aria-label="图标"] [role="radio"]')
        .find((e) => e.getAttribute('aria-checked') === 'true');
      return b ? b.getAttribute('aria-label') : null;
    },
    gridSize: () => all('[role="radiogroup"][aria-label="图标"] [role="radio"]').length,
    clickDialog: (t) => {
      const b = dlgBtn(t);
      if (!b || b.disabled) return false;
      b.click();
      return true;
    },
    dialogError: () => {
      const d = q('[role="dialog"] p.text-danger');
      return d ? d.textContent.trim() : null;
    },
    // 开某自建视图的「设置图标」对话框
    openEdit: (title) => {
      const b = q('[aria-label="设置图标 ' + title + '"]');
      if (!b) return false;
      b.click();
      return true;
    },
    // 侧栏自建行读数:data-view-icon(入库名)+ 图标 svg 类名 + 标题相对行的左偏移(px)
    rows: () => all('[data-view-id]').map((r) => {
      const box = r.querySelector('[data-view-icon]');
      const svg = box ? box.querySelector('svg') : null;
      const t = r.querySelector('span.truncate');
      return {
        id: Number(r.getAttribute('data-view-id')),
        title: t ? t.textContent.trim() : null,
        attr: box ? box.getAttribute('data-view-icon') : null,
        svg: svg ? svg.getAttribute('class') : null,
        left: t ? round(t.getBoundingClientRect().left - r.getBoundingClientRect().left) : null,
      };
    }),
    row: (title) => X.rows().find((r) => r.title === title) || null,
    // 内置三行读数:svg 是否渲染 + 类名 + 行内有没有「设置图标」入口
    builtin: (key) => {
      const r = q('[data-view-key="' + key + '"]');
      if (!r) return null;
      const svg = r.querySelector('svg');
      return {
        svg: svg ? svg.getAttribute('class') : null,
        editEntry: !!r.querySelector('[aria-label^="设置图标"]'),
      };
    },
    builtinKeys: () => all('[data-view-key]').map((e) => e.getAttribute('data-view-key')),
    anyEditEntryCount: () => all('[aria-label^="设置图标"]').length,
    bodyText: () => document.body.innerText.slice(0, 200),
  };
  window.__X = X;
  return true;
})()`;
