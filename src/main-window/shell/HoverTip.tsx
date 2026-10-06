/**
 * 瞬时悬浮提示:原生 `title` 有约 1 秒延迟且不可配置,用户要求"悬停即显示备注"。
 *
 * 做法:document 上的事件委托,只认带 `data-tip` 的元素(标签名里的备注字由 `renderTagLabel` 打这个属性)。
 * 元素自带文本,不需要各处组件维护悬浮状态;鼠标离开即隐藏,气泡本身 `pointer-events-none` 不吃点击。
 * 位置:元素下方居中;贴边时夹回视口内,下方空间不够就翻到上方。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { TIP_GAP, TipBubble } from './TipBubble';

interface TipRow {
  label: string;
  value: string;
}

interface Tip {
  text: string;
  /** 档案卡片的附加行(锚点上的 data-tip-rows) */
  rows: TipRow[];
  x: number;
  /** 目标的上下边(视口坐标),用于贴边翻转 */
  top: number;
  bottom: number;
  above: boolean;
}

/** 锚点上的 `data-tip-rows` = JSON 的 `[{label, value}]`(标签档案卡片);缺省/坏数据当没有 */
function parseRows(el: Element): TipRow[] {
  const raw = el.getAttribute('data-tip-rows') ?? '';
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: TipRow[] = [];
    for (const r of parsed) {
      if (typeof r !== 'object' || r === null) continue;
      const { label, value } = r as Partial<TipRow>;
      if (typeof label === 'string' && typeof value === 'string') out.push({ label, value });
    }
    return out;
  } catch {
    return [];
  }
}

const EDGE = 8;
const FLIP_SPACE = 48;

export function HoverTip(): ReactNode {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const holder = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? t.closest('[data-tip]') : null;
    const over = (e: Event): void => {
      const el = holder(e.target);
      const text = el?.getAttribute('data-tip') ?? '';
      if (el === null || text === '') return;
      const r = el.getBoundingClientRect();
      const half = Math.min(r.width / 2 + TIP_GAP, window.innerWidth / 2 - EDGE);
      setTip({
        text,
        rows: parseRows(el),
        x: Math.min(Math.max(r.left + r.width / 2, EDGE + half), window.innerWidth - EDGE - half),
        top: r.top,
        bottom: r.bottom,
        above: r.bottom + FLIP_SPACE > window.innerHeight && r.top > FLIP_SPACE,
      });
    };
    const out = (e: Event): void => {
      if (holder(e.target) !== null) setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
    };
  }, []);

  if (tip === null) return null;
  // 锚点按翻转方向取上下边:气泡挂在下方时贴目标底边,翻到上方时贴目标顶边(TipBubble 内部的 GAP)
  return (
    <TipBubble
      text={tip.text}
      rows={tip.rows}
      x={tip.x}
      y={tip.above ? tip.top : tip.bottom}
      above={tip.above}
    />
  );
}
