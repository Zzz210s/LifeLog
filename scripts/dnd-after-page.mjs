/**
 * 改后读数探针的页面内命名空间(注入用;只读 DOM + 页面内合成 DragEvent,不碰 OS 鼠标)。
 * 读数口径与改前探针一致:落点看 DOM 标记(data-drop-target / data-gap-active / 回执),
 * 不用 dataTransfer.dropEffect(合成 DataTransfer 的赋值读不回来,改前已证)。
 */
export const PAGE = `window.__DND__ = (() => {
  let DT = new DataTransfer();
  const q = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const row = (p) => q('[data-tag-path="' + p + '"]');
  const list = () => q('[data-testid="tag-list"]');
  const tick = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 80 : ms));
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), left: +r.left.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
  const fire = (el, type, x, y) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: DT, clientX: x, clientY: y }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const flash = () => (q('[data-testid="tag-flash"]') ? q('[data-testid="tag-flash"]').textContent.trim() : null);
  /** 指示线读数:行自己画的 1px before/after 线(改前是热区第二条 2px 线,已移除) */
  const lines = () => all('[data-drop-line]').map((el) => {
    const cs = getComputedStyle(el); const b = box(el); const owner = el.closest('[data-tag-path]');
    const ob = box(owner); const ocs = getComputedStyle(owner);
    return { zone: el.getAttribute('data-drop-line'), path: owner.getAttribute('data-tag-path'), height: cs.height,
      background: cs.backgroundColor, top: b.top, left: b.left, width: b.width,
      leftOffsetFromRow: +(b.left - ob.left).toFixed(1), rowPaddingLeft: ocs.paddingLeft,
      yOnBoundary: Math.abs(b.top - ob.top) < 1.5 || Math.abs(b.bottom - ob.bottom) < 1.5 };
  });
  const kind = (el) => { if (!el) return null; const o = (el.closest && el.closest('[data-gap-anchor],[data-tag-path],[data-testid]')) || el;
    return { tag: el.tagName.toLowerCase(), testid: o.getAttribute('data-testid'), path: o.getAttribute('data-tag-path'),
      band: o.getAttribute('data-gap-anchor') ? o.getAttribute('data-gap-anchor') + ':' + o.getAttribute('data-gap-zone') : null }; };
  const ensureExpanded = async (p, child) => { const el = row(p); if (!el) return false; if (row(child)) return true;
    const svg = el.querySelector('svg'); if (svg) svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await tick(250); return !!row(child); };
  const collapse = async (p, child) => { const el = row(p); if (row(child)) { const svg = el.querySelector('svg'); svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await tick(200); } return !row(child); };
  const state = () => { const t = q('[data-drop-target]'); const g = q('[data-gap-active="true"]'); const bar = q('[data-testid="tag-root-drop"]');
    const src = q('[data-drag-source="true"]');
    return { over: t ? { path: t.getAttribute('data-tag-path'), zone: t.getAttribute('data-drop-target') } : null,
      bandActive: g ? { anchor: g.getAttribute('data-gap-anchor'), zone: g.getAttribute('data-gap-zone') } : null,
      lineCount: lines().length, lines: lines(),
      gapCount: all('[data-gap-anchor]').length, bandCount: all('[data-gap-anchor]').length / 2,
      rootBar: !!bar, rootHighlight: !!bar && String(bar.className).includes('border-accent'),
      sourceMark: src ? src.getAttribute('data-tag-path') : null, flash: flash() }; };
  const start = async (p) => { DT = new DataTransfer(); const el = row(p); const r = box(el); await end();
    const prevented = fire(el, 'dragstart', r.left + r.width / 2, r.top + r.height / 2); await tick(150); return { prevented, box: r, state: state() }; };
  const end = async () => { const s = q('[data-drag-source="true"]'); if (s) { const r = box(s); fire(s, 'dragend', r.left + 2, r.top + 2); } await tick(150); return state(); };
  return {
    box, row, list, tick, state, start, end, fire, lines, kind, ensureExpanded, collapse,
    /** T1:指针在上下缘 1.5s(可含拖动指针),读位移、每帧最大值与静止 1000ms 后是否停 */
    t1: async (dir, src, moving) => { await end(); await start(src);
      const sc = list(); sc.scrollTop = dir === 'bottom' ? 0 : sc.scrollHeight; await tick(250);
      const r = box(sc); const x = r.left + r.width / 2; const y = dir === 'bottom' ? r.bottom - 12 : r.top + 6;
      const samples = []; let stop = false; const t0 = Date.now();
      const sampler = () => { samples.push({ t: Date.now() - t0, top: sc.scrollTop }); if (!stop) requestAnimationFrame(sampler); };
      requestAnimationFrame(sampler);
      const before = sc.scrollTop; let prevented = 0;
      for (let i = 0; i < 30; i++) { const el = document.elementFromPoint(x, y) || sc;
        const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: DT,
          clientX: x, clientY: moving ? y + Math.sin(i) : y });
        el.dispatchEvent(ev); if (ev.defaultPrevented) prevented++; await tick(50); }
      const mid = { t: Date.now() - t0, top: sc.scrollTop };
      await tick(850); const idle = { t: Date.now() - t0, top: sc.scrollTop };
      await tick(500); const idle2 = { t: Date.now() - t0, top: sc.scrollTop };
      stop = true; await tick(60);
      const deltas = samples.slice(1).map((s, i) => +(s.top - samples[i].top).toFixed(1));
      const out = { dir, y: +y.toFixed(1), prevented, before, after: sc.scrollTop, delta: sc.scrollTop - before,
        maxFrameDelta: deltas.length ? Math.max.apply(null, deltas) : 0, minFrameDelta: deltas.length ? Math.min.apply(null, deltas) : 0,
        at1500: mid, at2350: idle, at2850: idle2, idleDelta: idle.top - mid.top, afterStopDelta: idle2.top - idle.top,
        pxPerSec: +((mid.top - before) / 1.5).toFixed(1), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight };
      await end(); return out; },
    /** T1 封顶读数:把 dragover 直接投给滚动容器(指针落在其下缘外 15px),越界 50px -> 0.3*50=15 应夹到 14 */
    t1cap: async (src) => { await end(); await start(src); const sc = list(); sc.scrollTop = 0; await tick(250);
      const r = box(sc); const x = r.left + r.width / 2; const y = r.bottom + 15;
      const samples = []; let stop = false;
      const sampler = () => { samples.push(sc.scrollTop); if (!stop) requestAnimationFrame(sampler); };
      requestAnimationFrame(sampler);
      const before = sc.scrollTop;
      for (let i = 0; i < 10; i++) { fire(sc, 'dragover', x, y); await tick(50); }
      stop = true; await tick(80);
      const deltas = samples.slice(1).map((v, i) => +(v - samples[i]).toFixed(1));
      const out = { y: +y.toFixed(1), overshoot: +(y - r.bottom + 35).toFixed(1), before, after: sc.scrollTop,
        delta: +(sc.scrollTop - before).toFixed(1), maxFrameDelta: deltas.length ? Math.max.apply(null, deltas) : 0,
        minFrameDelta: deltas.length ? Math.min.apply(null, deltas) : 0 };
      await end(); return out; },
    /** T2:折叠有子级的行,行中部悬停 500ms(每 50ms 派发一次),看子行是否出现 */
    t2: async (p, child, src) => { await end(); const collapsed = await collapse(p, child); await start(src);
      const r = box(row(p)); const x = r.left + r.width / 2; const y = r.top + r.height / 2; let seen = null;
      for (let i = 0; i < 12; i++) { const el = row(p) || q('[data-testid="tag-list"]');
        fire(el, 'dragover', x, y); if (i === 2) seen = state(); await tick(50); }
      const at600 = !!row(child); const st = state(); await end();
      return { collapsed, sawExpandedAt600ms: at600, stateDuringHover: seen, stateAfter: st }; },
    /** T3:命中测试(行内 4 个位置 + 边界带上下半)+ 指示线条数 */
    t3: async (p, ratios, src, withBands) => { await end(); await start(src); const el = row(p); if (!el) return { missing: p };
      el.scrollIntoView({ block: 'center' }); await tick(200);
      const r = box(el); const out = { rowBox: r, byRatio: [], bands: [], maxLineCount: 0 };
      for (const ratio of ratios) { const x = r.left + r.width / 2; const y = r.top + r.height * ratio;
        const hit = document.elementFromPoint(x, y); const prevented = fire(hit || el, 'dragover', x, y); await tick(60);
        const st = state(); out.maxLineCount = Math.max(out.maxLineCount, st.lineCount);
        out.byRatio.push({ ratio, dy: +((y - r.top).toFixed(1)), hit: kind(hit), prevented, over: st.over, bandActive: st.bandActive, lineCount: st.lineCount, lines: st.lines }); }
      if (!withBands) { await end(); return out; }
      for (const half of ['top', 'bottom']) { const g = all('[data-gap-anchor]').filter((x) => x.getBoundingClientRect().top > r.top - 20 && x.getBoundingClientRect().top < r.bottom + 20);
        for (const el2 of g) { if (el2.getBoundingClientRect().height < 3) continue;
          const gb = box(el2); const y2 = half === 'top' ? gb.top + gb.height * 0.25 : gb.top + gb.height * 0.75;
          const prevented = fire(el2, 'dragover', gb.left + gb.width / 2, y2); await tick(60); const st = state();
          out.maxLineCount = Math.max(out.maxLineCount, st.lineCount);
          out.bands.push({ anchor: el2.getAttribute('data-gap-anchor'), zone: el2.getAttribute('data-gap-zone'), half, prevented, over: st.over, lineCount: st.lineCount, lines: st.lines }); } }
      await end(); return out; },
    /** T4 边界带:悬停锚点行某半边(可带 drop),用于"子孙锚点冒泡到祖先"的读数 */
    t4band: async (from, anchor, half, doDrop) => { await end(); if (!row(from)) return { missing: from }; await start(from);
      const g = all('[data-gap-anchor="' + anchor + '"]').filter((x) => x.getBoundingClientRect().height >= 3)[0];
      if (!g) return { missing: anchor };
      const gb = box(g); const y = gb.top + gb.height * (half === 'upper' ? 0.25 : 0.75);
      const prevented = fire(g, 'dragover', gb.left + gb.width / 2, y); await tick(120); const st = state();
      const hover = { anchor, zone: g.getAttribute('data-gap-zone'), half, prevented, over: st.over, lineCount: st.lineCount, lines: st.lines };
      let dropPrevented = null; let after = null;
      if (doDrop) { dropPrevented = fire(g, 'drop', gb.left + gb.width / 2, y); await tick(700); after = { flash: flash() }; }
      await end(); return { hover, dropPrevented, after }; },
    /** T4:悬停反馈 + 落点(无效目标冒泡);drop 后读回执与路径 */
    t4: async (from, to, ratio) => { await end(); const el = row(to); if (!el) return { missing: to }; await start(from); const r = box(el);
      const y = ratio === undefined ? r.top + r.height / 2 : r.top + r.height * ratio;
      const hover = { hit: kind(el), prevented: fire(el, 'dragover', r.left + r.width / 2, y), state: state() };
      const dropPrevented = fire(el, 'drop', r.left + r.width / 2, y); await tick(400);
      const after = { state: state(), flash: flash(), paths: null };
      await end(); return { hover, dropPrevented, after }; },
    /** T5:视觉契约(行高亮背景 / 1px 线几何与颜色 / 缩进 / 源行透明度 / 线数) */
    t5: async (target, src, baseline) => { await end(); await start(src); const out = { sourceRow: null, child: null, line: null, plainRow: null };
      const s = row(src); const scs = getComputedStyle(s); out.sourceRow = { path: src, opacity: scs.opacity, background: scs.backgroundColor };
      const base = row(baseline); out.plainRow = base ? { path: baseline, background: getComputedStyle(base).backgroundColor, boxShadow: getComputedStyle(base).boxShadow } : null;
      const r = box(row(target)); fire(row(target), 'dragover', r.left + r.width / 2, r.top + r.height / 2); await tick(400);
      const t = row(target); const tcs = getComputedStyle(t);
      out.child = { path: target, background: tcs.backgroundColor, boxShadow: tcs.boxShadow, lineCount: lines().length };
      await end(); await start(src);
      const g = all('[data-gap-anchor]').filter((x) => x.getBoundingClientRect().height >= 3)[0];
      if (g) { const gb = box(g); fire(g, 'dragover', gb.left + gb.width / 2, gb.top + gb.height * 0.6); await tick(400);
        out.line = { count: lines().length, lines: lines(), bandActive: state().bandActive, over: state().over }; }
      await end(); return out; },
    /** T6:拖拽态兜底(dragend / 窗口 pointerup / 源行卸载)后残留热点数 */
    t6: async (src, ROOT) => { await end(); await start(src); const during = { gapCount: all('[data-gap-anchor]').length, rootBar: !!q('[data-testid="tag-root-drop"]') };
      await end(); const afterDragEnd = { gapCount: all('[data-gap-anchor]').length, rootBar: !!q('[data-testid="tag-root-drop"]'), sourceMark: state().sourceMark, flash: flash() };
      await start(src); const during2 = all('[data-gap-anchor]').length;
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await tick(150);
      const afterPointerUp = { gapCount: all('[data-gap-anchor]').length, rootBar: !!q('[data-testid="tag-root-drop"]'), sourceMark: state().sourceMark, lineCount: lines().length };
      await start(src); const beforeUnmount = all('[data-gap-anchor]').length;
      await collapse(ROOT, src); // 折叠源的父级 -> 源行卸载
      const afterUnmount = { gapCount: all('[data-gap-anchor]').length, sourceMark: state().sourceMark, path: src };
      await ensureExpanded(ROOT, src);
      return { during, afterDragEnd, during2, afterPointerUp, beforeUnmount, afterUnmount }; },
    /** T7:同父级边界带归一化(两半同一落点)+ dragleave 防抖(30ms 保留 / 150ms 清除) */
    t7: async (src, next) => { await end(); await start(src); const out = { halves: [], debounce: null };
      const gs = all('[data-gap-anchor]').filter((x) => x.getBoundingClientRect().height >= 3);
      for (const g of gs) { if (g.getAttribute('data-gap-anchor') !== next) continue; const gb = box(g);
        for (const half of [0.25, 0.75]) { fire(g, 'dragover', gb.left + gb.width / 2, gb.top + gb.height * half); await tick(60);
          out.halves.push({ zone: g.getAttribute('data-gap-zone'), half: half < 0.5 ? 'upper' : 'lower', over: state().over }); } }
      const target = row(next) || q('[data-testid="tag-list"]'); const tr = box(target);
      fire(target, 'dragover', tr.left + tr.width / 2, tr.top + tr.height / 2); await tick(60);
      const before = state().over; fire(target, 'dragleave', tr.left + 2, tr.top + 2); await tick(30);
      const at30 = state().over; fire(target, 'dragover', tr.left + tr.width / 2, tr.top + tr.height / 2); await tick(60);
      const reHover = state().over; fire(target, 'dragleave', tr.left + 2, tr.top + 2); await tick(150);
      const at150 = state().over;
      out.debounce = { hover: before, at30ms: at30, reHover, at150ms: at150 };
      await end(); return out; },
    /** T8:源已在根级时悬停/落在根级区:是否还有反馈与回执 */
    t8: async (src) => { await end(); await start(src); const sc = list(); sc.scrollTop = sc.scrollHeight; await tick(200);
      const r = box(sc); const x = r.left + 2; const y = r.top + r.height * 0.5;
      const hit = document.elementFromPoint(x, y); const prevented = fire(hit || sc, 'dragover', x, y); await tick(80);
      const hoverState = state(); const dropPrevented = fire(hit || sc, 'drop', x, y); await tick(500);
      const bar = q('[data-testid="tag-root-drop"]'); const barBox = bar ? box(bar) : null;
      let barHover = null; let barDrop = null;
      if (bar) { barHover = fire(bar, 'dragover', barBox.left + barBox.width / 2, barBox.top + barBox.height / 2);
        await tick(80); barHover = { prevented: barHover, state: state() };
        barDrop = fire(bar, 'drop', barBox.left + barBox.width / 2, barBox.top + barBox.height / 2); await tick(500); barDrop = flash(); }
      const out = { flashOnHover: hoverState.flash, hover: { hit: kind(hit), prevented, rootHighlight: hoverState.rootHighlight, over: hoverState.over, flash: hoverState.flash },
        dropPrevented, flashAfterDrop: flash(), rootBarDuringDrag: barBox !== null, barHover, barDrop };
      await end(); return out; },
  };
})(); 'ok'`;
