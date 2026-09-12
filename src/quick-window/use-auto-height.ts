import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { clampLines, GLOW_PAD, heightForLines } from '../shared/quick-geometry';
import { readGeometry } from './logical-size';

/**
 * 输入内容对应的窗口高度(逻辑像素)。
 * textarea 撑满窗口,直接读 scrollHeight 在「窗口比内容高」时会等于窗口高,窗口将永远缩不回去;
 * 故先把它压到 0 高再读 scrollHeight,拿到真实换行后的内容高度,再钳到 1-5 行。
 * scrollHeight 含内边距、不含边框,故行高换算只减内边距,回加时补回边框。
 * 占位文案会按当前宽度参与换行、也被算进 scrollHeight(实测窄窗口空输入会多算一行),
 * 故测量期间暂清占位文案。
 */
export function windowHeightFor(
  ta: HTMLTextAreaElement,
  ratio: number,
  cssWidth?: number,
): number {
  const cs = getComputedStyle(ta);
  const line = parseFloat(cs.lineHeight) || 0;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const prevHeight = ta.style.height;
  const prevWidth = ta.style.width;
  const prevPlaceholder = ta.placeholder;
  if (cssWidth && cssWidth > 0) ta.style.width = `${cssWidth}px`;
  ta.placeholder = '';
  ta.style.height = '0px';
  const content = ta.scrollHeight - padY;
  ta.style.height = prevHeight;
  ta.placeholder = prevPlaceholder;
  ta.style.width = prevWidth;
  const lines = clampLines(line > 0 ? content / line : 1);
  // 向上取整:逻辑高度还要经「scale 换算 + 物理取整」才落到窗口上,
  // 四舍五入可能让实际 CSS 高度比内容少不到 1 像素,溢出即触发 overflow-y-auto 滚动条。
  return Math.ceil((heightForLines(lines, line) + padY + borderY + 2 * GLOW_PAD) * ratio);
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
 * 返回同步函数:缩放变化后窗口的 CSS 空间会变,调用方(滞轮缩放)需手动再同步一次。 */
export function useAutoHeight(opts: {
  textareaRef: { current: HTMLTextAreaElement | null };
  value: string;
}): () => void {
  const { textareaRef, value } = opts;
  const activated = useWindowActivated();

  const sync = useCallback(() => {
    const ta = textareaRef.current;
    if (!activated || !ta) return;
    void readGeometry().then((geo) => {
      if (!geo) return;
      const height = windowHeightFor(ta, geo.ratio);
      // 1 逻辑像素容差:物理尺寸往返取整会带来不到 1 像素的抖动,避免每次内容变化都改窗口
      if (Math.abs(height - geo.height) <= 1) return;
      // 宽度必须是整数:命令签名是 u32,浮点会被 IPC 拒绝
      void api.setQuickSize(Math.round(geo.width), height).catch(() => {});
    });
  }, [activated, textareaRef]);

  useEffect(() => {
    sync();
  }, [sync, value]);

  return sync;
}
