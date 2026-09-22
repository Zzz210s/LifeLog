// 卸载兜底保存(2026-09-21,用户实测"两种离开方式都没保存"后加):
// 只要用户改过内容、且没有主动取消,面板一卸载就把 DOM 里的字写库。
// 覆盖"点区块外 / 切到另一条笔记 / 窗口失焦 / 列表刷新把面板换掉"等**所有**离开方式,
// 不依赖任何一条通道的时序(输入法组合期间 React state 可能落后,所以以 DOM 镜像为准)。
//
// 静默:失败无处呈现(面板已卸载),成功也不改界面(退出是既定事实)。
// 写库走唯一出口(../data/note-writes):它成功后通知标签新鲜度 —— 这条路径没有任何 reload 回调
// 通道,若直接调 api.updateNote,编辑里新加的标签会不进 `#` 候选(复审 I2 绕过 1)。
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { updateNote } from '../data/note-writes';
import { prepareForSave } from '../../shared/note-source';

export interface SaveOnUnmountRefs {
  noteId: number;
  /** 挂载时的源码:与它相同即「未变」,不写库 */
  initial: RefObject<string>;
  /** 取当前文本:优先活着的 DOM,读不到时回退镜像(卸载时 DOM 可能已被摘掉) */
  getText: () => string;
  /** 已成功写库:不再重复保存 */
  saved: RefObject<boolean>;
  /** 用户主动取消(Esc/取消按钮):不保存 */
  cancelled: RefObject<boolean>;
}

export function useSaveOnUnmount(refs: SaveOnUnmountRefs): void {
  const { noteId, initial, getText, saved, cancelled } = refs;
  useEffect(
    () => () => {
      if (saved.current || cancelled.current) return;
      const text = prepareForSave(getText());
      if (text === null || text === prepareForSave(initial.current)) return;
      try {
        void Promise.resolve(updateNote(noteId, text)).catch(() => undefined);
      } catch {
        // 同步抛错同样忽略
      }
    },
    [noteId, initial, getText, saved, cancelled]
  );
}
