// 滚动测量公共件:CDP 连接 + 页面内枚举器 + 无鼠标输入(滚轮/键盘) + 截图取列。
// 纪律:所有滚动一律走 CDP Input.dispatchMouseEvent(mouseWheel) / Input.dispatchKeyEvent,
// 页面动作走 Runtime.evaluate —— 不使用任何 OS 级鼠标事件(避免点到真实窗口)。
import { sleep, waitFor, open, ensureMain } from './cdp-lib.mjs';
import { decodePng } from './dev-scroll-png.mjs';

export { sleep, waitFor, open, ensureMain };

/** 连接主窗(冷启动时先经托盘开出来) */
export const main = (opts) => ensureMain(opts);
/** 连接输入栏页面(必须已显示,否则没有 page target) */
export const input = () => open('input');

const PAGE = `(() => {
  const sel = (el) => {
    const parts = [];
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const aria = cur.getAttribute && cur.getAttribute('aria-label');
      if (aria) { parts.unshift(cur.tagName.toLowerCase() + '[aria-label="' + aria + '"]'); break; }
      const testid = cur.dataset && cur.dataset.testid;
      if (testid) { parts.unshift('[data-testid="' + testid + '"]'); break; }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const info = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel: sel(el), tag: el.tagName.toLowerCase(),
      aria: el.getAttribute('aria-label'), testid: (el.dataset && el.dataset.testid) || null,
      cls: String(el.className || '').slice(0, 70),
      cw: el.clientWidth, ch: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight,
      ow: el.offsetWidth, oh: el.offsetHeight,
      barW: el.offsetWidth - el.clientWidth, barH: el.offsetHeight - el.clientHeight,
      ox: cs.overflowX, oy: cs.overflowY,
      sbWidth: cs.scrollbarWidth, gutter: cs.scrollbarGutter,
      scheme: cs.colorScheme, bg: cs.backgroundColor, color: cs.color,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      overX: el.scrollWidth > el.clientWidth + 1, overY: el.scrollHeight > el.clientHeight + 1,
      top: Math.round(el.scrollTop), left: Math.round(el.scrollLeft),
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    };
  };
  const scrollable = (cs) => /(auto|scroll|overlay)/.test(cs.overflowX) || /(auto|scroll|overlay)/.test(cs.overflowY);
  window.__probe = {
    sel, info,
    /** 枚举 scope 内所有"可滚动且真的溢出"的元素(含 document 级读数) */
    scrollables(scopeSel) {
      const root = scopeSel ? document.querySelector(scopeSel) : document;
      if (!root) return null;
      const items = [];
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!scrollable(cs)) continue;
        if (el.clientWidth === 0 && el.clientHeight === 0 && el.scrollHeight === 0) continue;
        if (!(el.scrollHeight > el.clientHeight + 1) && !(el.scrollWidth > el.clientWidth + 1)) continue;
        items.push(info(el));
      }
      const de = document.scrollingElement;
      return { items, doc: info(de), win: { iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio } };
    },
    /** 指定选择器的读数(找不到返回 null);force 为真时忽略"未溢出"过滤 */
    one(scopeSel, sub) {
      const root = document.querySelector(scopeSel);
      const el = sub ? root && root.querySelector(sub) : root;
      return el ? info(el) : null;
    },
    /** 按选择器点击/派发事件(不经 OS 鼠标) */
    fire(scopeSel, sub, type, init) {
      const root = document.querySelector(scopeSel);
      const el = sub ? root && root.querySelector(sub) : root;
      if (!el) return false;
      el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, init || {})));
      return true;
    },
    /** 受控输入/文本域设值:必须走原型 setter + input 事件,否则 React 的 onChange 不触发 */
    setValue(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value.length;
    },
  };
  return true;
})()`;

export async function install(cdp) {
  return cdp.eval(PAGE);
}

/**
 * 整页重载并等到 waitExpr 为真:重载期间 CDP 上下文会短暂不可用,
 * 故这里的轮询必须吞掉异常(直接 eval 会抛 "Cannot find context"),重载后需重装页内助手。
 */
export async function reloadPage(cdp, waitExpr = `!!document.querySelector('.md-body')`, tries = 40) {
  try {
    await cdp.send('Page.reload', {});
  } catch {
    await cdp.eval('location.reload()').catch(() => {});
  }
  await sleep(1500);
  for (let i = 0; i < tries; i++) {
    try {
      if (await cdp.eval(waitExpr)) {
        await install(cdp);
        return true;
      }
    } catch {}
    await sleep(400);
  }
  return false;
}

export const js = (cdp, expr) => cdp.eval(expr);
export const scrollables = (cdp, scopeSel = null) =>
  cdp.eval(`window.__probe.scrollables(${scopeSel ? JSON.stringify(scopeSel) : 'null'})`);
export const one = (cdp, sel, sub = null) =>
  cdp.eval(`window.__probe.one(${JSON.stringify(sel)}, ${sub ? JSON.stringify(sub) : 'null'})`);
export const fire = (cdp, sel, sub, type, init = {}) =>
  cdp.eval(`window.__probe.fire(${JSON.stringify(sel)}, ${sub ? JSON.stringify(sub) : 'null'}, ${JSON.stringify(type)}, ${JSON.stringify(init)})`);

/** 滚轮:CDP 合成 mouseWheel(非 OS 鼠标);(x,y) 为 CSS 像素视口坐标 */
export async function wheel(cdp, x, y, deltaY, deltaX = 0, modifiers = 0) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, pointerType: 'mouse',
  });
}

const VK = { PageDown: 34, PageUp: 33, Home: 36, End: 35, ArrowDown: 40, ArrowUp: 38, Escape: 27, Space: 32 };
/** 键盘:CDP 合成 keyDown/keyUp(走浏览器默认滚动行为) */
export async function key(cdp, k, modifiers = 0) {
  const code = VK[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers,
    });
  }
}

/** 截图并解码。clip 为 CSS 像素矩形;返回 { width, height, dpr, at } */
export async function shot(cdp, clip) {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  const img = decodePng(Buffer.from(r.data, 'base64'));
  return { ...img, dpr: clip ? img.width / clip.width : null };
}

/** 用任意表达式定位元素并返回稳定选择器路径(表达式求值结果须是元素或 null) */
export const findSel = (cdp, expr) =>
  cdp.eval(`(() => { const el = ${expr}; return el ? window.__probe.sel(el) : null; })()`);

/** 元素中心点的视口 CSS 坐标(滚轮落点) */
export const center = async (cdp, sel) => {
  const r = await rect(cdp, sel);
  return r ? { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + Math.min(r.h / 2, 200)) } : null;
};

/** 元素矩形(CSS 像素),用于给出滚动条所在列 */
export const rect = (cdp, sel) =>
  cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);


/** 把读数按 key 存成 JSON 片段(报告取证用) */
export function dump(name, value) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(value, null, 2));
}
