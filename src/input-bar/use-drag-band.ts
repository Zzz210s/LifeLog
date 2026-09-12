import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isInDragBand, pressKind } from '../shared/input-gestures';
import { dragBandCss } from '../shared/input-geometry';
import { currentRatio } from './logical-size';

// 可拖动移动窗口的区域 = 上下最外 8 **逻辑像素**带 + 输入框外的 14 CSS 像素光晕内边距环,
// 取两者较大者:低缩放(ratio 0.5)时 8 逻辑像素 = 16 CSS px,比环还宽,热区随缩放一起放大;
// 高缩放时环已盖住 8 逻辑像素,取环即可(不把既有可拖动环缩窄)。
// **控制端已裁决保留**:纯逻辑像素换算会在 2.0 缩放下把「整圈 14 CSS px 可拖」缩成 4 px,
// 属能力回归,故不做纯换算(详见 input-geometry.dragBandCss)。
// 左右最外 8 逻辑像素另由 use-width-drag 优先接管改宽度(见 InputBar 的 onRootMouseDown);
// 输入框内的中部区域不拖动,保留文本选择。
// **「阻止移动」只拦这里的窗口移动,不拦左右边缘的宽度拉伸**(用户 2026-09-11 决定:
// 锁定移动不等于锁死宽度;宽度改动见 use-width-drag)
// 双击在 mousedown 阶段判定(e.detail >= 2),因为原生拖动会吞掉后续 dblclick;
// locked 只拦拖动,不拦双击(「阻止关闭」才拦隐藏)。
export function useDragBand(opts: { locked: boolean; onDoubleClick: () => void }) {
  const { locked, onDoubleClick } = opts;
  // 是否有已置位、等着结算的拖动会话。原生拖动期间页面收不到 mouseup(实测),故改用
  // 挂载时注册一次的常驻监听(回调里判 pending),而不是每次拖动都 new 一个 { once: true }
  // 监听 —— 那种监听永不触发却永久残留在 window 上,拖 N 次残留 N 个。
  // 若页面终究收不到 mouseup,Rust 侧的空闲阈值会兜底结束会话(见 windowing/input.rs)。
  const pending = useRef(false);

  useEffect(() => {
    const onUp = () => {
      if (!pending.current) return; // 非拖动结束的 mouseup 不结算
      pending.current = false;
      void invoke('end_input_drag').catch(() => {});
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  return useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const inside = isInDragBand(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        dragBandCss(currentRatio()),
      );
      if (!inside) return;
      if (pressKind(e.detail) === 'double') {
        e.preventDefault();
        onDoubleClick();
        return;
      }
      if (locked) return;
      // 拖动会话:进入系统移动循环会收到 Focused(false),失焦自动隐藏开启时会把窗口拖到一半就隐藏。
      // 置位必须 await —— 不 await 的话 IPC 可能晚于失焦事件到达,标志就白设了;
      // 置位/结算失败都不阻断拖动(最多失去“拖动期间不失焦隐藏”这层保护)。
      pending.current = true;
      void (async () => {
        try {
          await invoke('begin_input_drag');
        } catch {
          // 吞掉:继续拖动
        }
        void getCurrentWindow().startDragging();
      })();
    },
    [locked, onDoubleClick],
  );
}
