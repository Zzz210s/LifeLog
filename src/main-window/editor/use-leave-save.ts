// 「离开编辑区块 = 保存」的三条触发通道(从 EditPanel 抽出以守 200 行上限):
//   ① 点编辑区块之外(文档级 pointerdown):区块内继续编辑;落点是另一条笔记正文则先存后进
//   ② 鼠标点到程序窗口之外:宿主窗口失焦 -> Rust 侧 emit BLUR_SAVE_EVENT(可靠信号)
//   ③ DOM window blur(兜底:WebView2 未必派发,派发了也只算一次 —— 在飞守卫挡住第二次)
// 保存失败(含空内容)必须留在编辑态;面板已被卸载时就地显示不了,转交主窗错误条。
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';

/** flush 的返回:与 EditPanel 的 CommitResult 结构兼容(成功分支没有 inline 字段) */
export type LeaveFlushResult =
  | { ok: true; changed: boolean }
  | { ok: false; message: string; inline: boolean; busy?: boolean };

export interface UseLeaveSaveArgs {
  panelRef: RefObject<HTMLElement | null>;
  flush: () => Promise<LeaveFlushResult>;
  /** 点区块外且落点是另一条笔记正文时进入那条的编辑 */
  onSwitchNote?: (noteId: number) => void;
  onCancel: () => void;
  /** 面板已卸载导致无法就地显示错误时的兜底出口 */
  onErrorFallback?: (message: string) => void;
  /** 该元素是否是"可点进编辑的正文"(默认查 data-note-body 属性) */
  shouldEnterEdit: (target: EventTarget | null, selectedText: string) => boolean;
}

/** 与 Rust 侧 main_window::BLUR_SAVE_EVENT 同值(改一处要同步另一处) */
export const BLUR_SAVE_EVENT = 'main-window-blur';

export function useLeaveSave(args: UseLeaveSaveArgs): void {
  const { panelRef, flush, onSwitchNote, onCancel, onErrorFallback, shouldEnterEdit } = args;
  useEffect(() => {
    const leave = (switchingTo: number | null): void => {
      void flush().then((r) => {
        if (!r.ok) {
          if (r.busy) return; // 上一次保存还在飞:这次离开不参与决策
          if (!r.inline) onErrorFallback?.(r.message);
          return;
        }
        if (switchingTo !== null) onSwitchNote?.(switchingTo);
        else if (!r.changed) onCancel(); // 未写库(内容未变)时由面板负责退出编辑
      });
    };
    const onDown = (e: Event): void => {
      const box = panelRef.current;
      if (!box || !(e.target instanceof Node) || box.contains(e.target)) return;
      const holder = e.target instanceof Element ? e.target.closest('[data-note-body]') : null;
      const nextId = holder ? Number(holder.getAttribute('data-note-body')) : Number.NaN;
      const switching =
        Number.isFinite(nextId) && shouldEnterEdit(e.target, window.getSelection()?.toString() ?? '');
      leave(switching ? nextId : null);
    };
    const onBlur = (): void => leave(null); // 点到窗口外:只保存,不切换
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('blur', onBlur);
    // 宿主窗口失焦的可靠通道(Rust: WindowEvent::Focused(false) -> emit);订阅失败不影响其余两条
    const unlisten = listen(BLUR_SAVE_EVENT, onBlur).catch(() => undefined);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('blur', onBlur);
      void unlisten.then((un) => un?.());
    };
  }, [panelRef, flush, onSwitchNote, onCancel, onErrorFallback, shouldEnterEdit]);
}
