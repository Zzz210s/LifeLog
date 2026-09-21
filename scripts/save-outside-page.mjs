/**
 * 保存判定探针的页面内命名空间(注入用):只派发页面内 pointerdown / click / keydown,
 * 不碰 OS 鼠标;读数一律取 DOM(编辑面板在不在、源码框文本、面板内中文错误)。
 */
export const PAGE = `window.__SAVE__ = (() => {
  const q = (s) => document.querySelector(s);
  const tick = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 150 : ms));
  const panel = () => q('[data-testid="edit-panel"]');
  const body = (id) => q('[data-note-body="' + id + '"]');
  const down = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const setText = (v) => { const el = panel().querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const hit = async (el) => { const r = el.getBoundingClientRect(); down(el, r.left + 8, r.top + 6); click(el); await tick(); };
  return {
    ids: () => Array.from(document.querySelectorAll('[data-note-body]')).map((e) => Number(e.getAttribute('data-note-body'))),
    state: () => { const p = panel(); const ta = p ? p.querySelector('textarea') : null; const text = p ? p.textContent : '';
      return { editing: !!p, source: ta ? ta.value : null,
        error: text.includes('内容不能为空') ? '内容不能为空' : text.includes('保存失败') ? '保存失败' : null,
        flash: q('[data-testid="tag-flash"]') ? q('[data-testid="tag-flash"]').textContent.trim() : null }; },
    /** 进编辑:点笔记正文(pointerdown + click,与真实鼠标同序) */
    enter: async (id) => { const b = body(id); if (!b) return { ok: false, reason: 'row-missing' }; const r = b.getBoundingClientRect();
      down(b, r.left + 8, r.top + 6); click(b); await tick(250); return { ok: !!panel(), state: window.__SAVE__.state() }; },
    /** 区块外点:target 省略 = 笔记流容器(非笔记正文);给了 id = 另一条笔记正文 */
    outside: async (id) => { const el = id ? body(id) : document.body;
      if (!el) return { ok: false, reason: 'target-missing' }; await hit(el); await tick(250); return { ok: true, state: window.__SAVE__.state() }; },
    /** 区块内点(源码框自身)= 继续编辑 */
    inside: async () => { await hit(panel().querySelector('textarea')); await tick(120); return window.__SAVE__.state(); },
    type: (v) => setText(v),
    esc: async () => { panel().querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(200); return window.__SAVE__.state(); },
    ctrlEnter: async () => { const ta = panel().querySelector('textarea');
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); await tick(400); return window.__SAVE__.state(); },
  };
})(); 'ok'`;
