import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { clampLines, GLOW_PAD, heightForLines } from '../shared/input-geometry';
import { readGeometry } from './logical-size';

/**
 * 输入内容对应的窗口高度(**基础逻辑像素**,即缩放 1 时的逻辑像素 —— 页面上就是内容高度的
 * CSS 像素值,与 webview 缩放无关)。为什么把单位定在缩放 1:缩放会同时改窗口尺寸,
 * 而缩放写库与几何读数分属两条异步链路;按“当前逻辑高度”传参需要 Rust 再除以缩放,
 * 实测(2026-09-21)交错时会把派生值固化进 input_w/input_h。Rust 侧只把缩放乘在落窗口的物理尺寸上,
 * 库里存的基础尺寸因此不带缩放因子。
 *
 * textarea 撑满窗口,直接读 scrollHeight 在「窗口比内容高」时会等于窗口高,窗口将永远缩不回去;
 * 故先把它压到 0 高再读 scrollHeight,拿到真实换行后的内容高度,再钳到 1-5 行。
 * scrollHeight 含内边距、不含边框,故行高换算只减内边距,回加时补回边框。
 * 输入框无占位文案(用户 2026-09-11 决定完全去掉),空内容时内容高度为 0 -> 钳到 1 行,
 * 即空输入就是单行基准高度,不会顶出滚动条。
 * `cssWidth` 是测量换行宽度时临时指定的输入框 CSS 宽度(拖动路径用);
 * `extraCss` 是输入框下方额外让出的高度(# 补全建议列表):窗口随之变高,列表因此长在输入框
 * 正下方而不是被压在弹窗里。测量时临时取消 flex 约束(flex: none)—— flex-1 会让
 * style.height=0 失效,量到的会是窗口高度而不是内容高度。
 */
export function windowHeightFor(
  ta: HTMLTextAreaElement,
  cssWidth?: number,
  extraCss = 0,
): number {
  const cs = getComputedStyle(ta);
  const line = parseFloat(cs.lineHeight) || 0;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const prevHeight = ta.style.height;
  const prevWidth = ta.style.width;
  const prevFlex = ta.style.flex;
  if (cssWidth && cssWidth > 0) ta.style.width = `${cssWidth}px`;
  ta.style.flex = 'none'; // flex-1 会让 height=0 失效:量到窗口高而不是内容高
  ta.style.height = '0px';
  const content = ta.scrollHeight - padY;
  ta.style.height = prevHeight;
  ta.style.width = prevWidth;
  ta.style.flex = prevFlex;
  const lines = clampLines(line > 0 ? content / line : 1);
  const extra = Number.isFinite(extraCss) && extraCss > 0 ? extraCss : 0;
  // 向上取整:Rust 还要乘「系统缩放 x webview 缩放」并做物理取整,
  // 四舍五入可能让实际 CSS 高度比内容少不到 1 像素,溢出即触发 overflow-y-auto 滚动条。
  return Math.ceil(heightForLines(lines, line) + padY + borderY + 2 * GLOW_PAD + extra);
}

/**
 * 窗口在启动时(visible: false)就已挂载,此时读到的是配置默认尺寸;
 * 若立刻把尺寸写回设置,会覆盖用户上次拉伸的宽度,故只在窗口至少显示过一次后才同步。
 * show() 会 set_focus(),故 tauri://focus 是可靠的「已被唤起」信号。
 */
function useWindowActivated(): boolean {
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    void win
      .isVisible()
      .then((visible) => {
        if (alive && visible) setActivated(true);
      })
      .catch(() => {});
    const unlisten = win.listen('tauri://focus', () => setActivated(true));
    return () => {
      alive = false;
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, []);
  return activated;
}

/** 内容或宽度变化后,把窗口高度同步到「实际换行行数」对应的高度(上限 5 行后内部滚动)。
 * 返回同步函数:缩放变化后窗口的 CSS 空间会变,调用方(滞轮缩放)需手动再同步一次。
 * `extraCss` = 建议列表占的高度:>0 时走**不落库**的 overlay 命令 —— 否则带着列表关闭应用,
 * 展开高度会被当成基础尺寸写进 input_h,下次启动就是一条悬空的空高条。 */
export function useAutoHeight(opts: {
  textareaRef: { current: HTMLTextAreaElement | null };
  value: string;
  extraCss?: number;
}): () => void {
  const { textareaRef, value } = opts;
  const extraCss = opts.extraCss ?? 0;
  const activated = useWindowActivated();

  /** 立即按当前内容/宽度重算高度(不受 activated 门控;只在“确定窗口已显示”的入口调) */
  const syncNow = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    void readGeometry().then((geo) => {
      if (!geo) return;
      const height = windowHeightFor(ta, undefined, extraCss);
      // geo.height / geo.ratio = 当前窗口高度换算回「基础逻辑高度」(ratio = 逻辑/CSS = 缩放),
      // 1 逻辑像素容差:物理尺寸往返取整会带来不到 1 像素的抖动,避免每次内容变化都改窗口。
      // 宽度**不传**:自动高度路径不掌握宽度意图,只让 Rust 按当前宽度改高度(它绝不写 input_w)。
      if (Math.abs(height - Math.round(geo.height / geo.ratio)) <= 1) return;
      const call = extraCss > 0 ? api.setInputHeightOverlay : api.setInputHeight;
      void call(height).catch(() => {});
    });
  }, [textareaRef, extraCss]);

  const sync = useCallback(() => {
    if (!activated) return;
    syncNow();
  }, [activated, syncNow]);

  useEffect(() => {
    sync();
  }, [sync, value]);

  // 窗口被后端显示后(show() 会 emit input-shown)重新同步一次:
  // show() 的尺寸是 apply_scale 从**库里的基础高**算出的,不含候选列表占的高度,而 120ms 重同步
  // 只在内容/宽度变化时跑 —— 带着展开的列表隐藏再显示时,窗口会一直停在“只算内容”的矮高,
  // 输入框被压瘪、列表被裁(2026-09-21 复审 Important 1;实测 864 -> 400 物理 px、输入框 118 -> 18 CSS)。
  // 只在列表开着时强制同步:列表关闭时库里的基础高本来就等于内容高(show 已算对),
  // 再同步是空操作,还会把“窗口比内容高”的既有观感改成每次显示都缩到内容高。
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen('input-shown', () => {
      if (extraCss > 0) syncNow();
    })
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {}); // 订阅失败不阻断显示流程
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [extraCss, syncNow]);

  return sync;
}
