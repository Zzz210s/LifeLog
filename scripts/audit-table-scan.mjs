// 表格视觉门禁(scripts/audit-table-style.mjs)的页面侧探针:只读计算样式,不做断言
// (与 audit-visual-scan.mjs 同风格,拆开是为了两边都留在 200 行以内)。
import { TOKEN_NAMES } from './audit-visual-scan.mjs';

const esc = (s) => JSON.stringify(s);
const HELP = `
  const cs = (el) => getComputedStyle(el);
  const root = document.documentElement;
  const tokens = {}; for (const n of ${esc(TOKEN_NAMES)}) tokens[n] = cs(root).getPropertyValue(n).trim();
  const norm = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = cs(d).color; d.remove(); return v; };
  const findMd = (s) => [...document.querySelectorAll('.md-body')].find((el) => el.textContent.includes(s));
`;

/** 找到夹具笔记并回目标卡片的视口位置(等它进 DOM 用) */
export const FIND_JS = (s) => `(() => {${HELP}
  const md = findMd(${esc(s)});
  if (!md) return null;
  const card = md.closest('li') || md;
  const b = card.getBoundingClientRect();
  return { top: Math.round(b.top), w: Math.round(b.width), tables: md.querySelectorAll('table').length };
})()`;

/** 主扫描:一张夹具卡里两张表(3 列数据表 + 8 列宽表)的结构/计算样式读数 */
export const SCAN_JS = (s) => `(() => {${HELP}
  const md = findMd(${esc(s)});
  if (!md) return { found: false };
  const tables = [...md.querySelectorAll('table')];
  if (tables.length < 2) return { found: false, why: '夹具里应有 2 张表,实见 ' + tables.length };
  const t0 = tables[0], t1 = tables[1];
  const th = t0.querySelector('thead th'), td = t0.querySelector('tbody td');
  const rows = [...t0.querySelectorAll('tbody tr')];
  const zebraTd = rows[1] ? rows[1].querySelectorAll('td')[0] : null;
  const longTd = rows[1] ? rows[1].querySelectorAll('td')[2] : null;
  // 只收真正画出来的颜色(零宽边框的 currentColor 不算硬编码)
  const paint = (el) => { const c = cs(el); const out = { color: c.color };
    if (c.backgroundColor !== 'rgba(0, 0, 0, 0)') out.bg = c.backgroundColor;
    for (const k of ['Top', 'Bottom', 'Left', 'Right']) {
      if (parseFloat(c['border' + k + 'Width']) > 0 && c['border' + k + 'Style'] !== 'none') out['border' + k] = c['border' + k + 'Color'];
    }
    return out; };
  const els = [t0, t1, ...md.querySelectorAll('th'), ...md.querySelectorAll('td')];
  const card = md.closest('li') || md;
  return {
    found: true, theme: root.classList.contains('dark') ? 'dark' : 'light',
    tok: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v ? norm(v) : null])),
    tokenColors: [...new Set(Object.values(tokens).filter(Boolean).map(norm))].sort(),
    colors: [...new Set(els.flatMap((el) => Object.values(paint(el))))].sort(),
    table: { fontSize: cs(t0).fontSize, display: cs(t0).display, overflowX: cs(t0).overflowX,
      borderTopWidth: cs(t0).borderTopWidth, borderTopStyle: cs(t0).borderTopStyle, borderTopColor: cs(t0).borderTopColor,
      scrollWidth: t0.scrollWidth, clientWidth: t0.clientWidth },
    th: { bg: cs(th).backgroundColor, borderBottomWidth: cs(th).borderBottomWidth, fontSize: cs(th).fontSize,
      position: cs(th).position, top: cs(th).top, textAlign: cs(th).textAlign, padding: cs(th).paddingTop + ' ' + cs(th).paddingLeft,
      h: Math.round(th.getBoundingClientRect().height) },
    td: { paddingTop: cs(td).paddingTop, paddingBottom: cs(td).paddingBottom, paddingLeft: cs(td).paddingLeft,
      paddingRight: cs(td).paddingRight, verticalAlign: cs(td).verticalAlign, maxWidth: cs(td).maxWidth,
      borderBottomWidth: cs(td).borderBottomWidth, borderBottomColor: cs(td).borderBottomColor },
    shortRowH: Math.round(rows[0].getBoundingClientRect().height),
    zebra: zebraTd ? { bg: cs(zebraTd).backgroundColor, color: cs(zebraTd).color } : null,
    long: longTd ? { h: Math.round(longTd.getBoundingClientRect().height), scrollHeight: longTd.scrollHeight,
      clientHeight: longTd.clientHeight, whiteSpace: cs(longTd).whiteSpace, textOverflow: cs(longTd).textOverflow,
      text: longTd.textContent } : null,
    wide: { scrollWidth: t1.scrollWidth, clientWidth: t1.clientWidth, w: Math.round(t1.getBoundingClientRect().width) },
    sticky: (() => {
      const t2 = tables[2];
      if (!t2) return { tallTableScrolls: false, headerStuckOffset: 999 };
      const th2 = t2.querySelector('thead th');
      t2.scrollTop = 240; // 内部纵向滚动(长表才会滚)
      const off = Math.round(th2.getBoundingClientRect().top - t2.getBoundingClientRect().top);
      const scrolls = t2.scrollHeight > t2.clientHeight + 1;
      t2.scrollTop = 0;
      return { tallTableScrolls: scrolls, headerStuckOffset: Math.abs(off) };
    })(),
    cardW: Math.round(card.getBoundingClientRect().width),
  };
})()`;

/** 把夹具卡的第 2 行(tbody tr:nth-child(2))滚进视口并回单元格中心坐标,供真实鼠标移动 */
export const HOVER_RECT_JS = (s) => `(() => {${HELP}
  const md = findMd(${esc(s)});
  const tr = md && md.querySelectorAll('tbody tr')[1];
  if (!tr) return null;
  tr.scrollIntoView({ block: 'center' });
  const td = tr.querySelectorAll('td')[0];
  const b = td.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
})()`;

/** 读悬停行底色 + 两个令牌真值(`:hover` 已由真实鼠标或 forcePseudoState 施加) */
export const HOVER_READ_JS = (s) => `(() => {${HELP}
  const md = findMd(${esc(s)});
  const tr = md && md.querySelectorAll('tbody tr')[1];
  if (!tr) return null;
  const td = tr.querySelectorAll('td')[0];
  return { bg: cs(td).backgroundColor, selected: norm(tokens['--color-selected']), canvas: norm(tokens['--color-canvas']),
    raised: norm(tokens['--color-raised']), text: cs(td).color };
})()`;

/** 给夹具卡第 2 行的 tr 打临时标记(forcePseudoState 需要 nodeId,用属性选择器定位) */
export const MARK_TR_JS = (s, on) => `(() => {${HELP}
  const md = findMd(${esc(s)});
  const tr = md && md.querySelectorAll('tbody tr')[1];
  if (!tr) return false;
  if (${on}) tr.setAttribute('data-audit-tr', '1'); else tr.removeAttribute('data-audit-tr');
  return true;
})()`;
