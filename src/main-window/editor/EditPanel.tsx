import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { composeSource, prepareForSave } from '../../shared/note-source';
import type { Note } from '../../shared/types';
import { shouldEnterEdit } from '../stream/body-click';
import { tagCountHint, tagCountLabel } from './edit-tag-count';
import { editRows } from './textarea-rows';
import { useSourceTagCount } from './use-source-tags';
import { useLeaveSave } from './use-leave-save';

export interface EditPanelProps {
  note: Note;
  onSaved: (note: Note) => void;
  onCancel: () => void;
  /** 挂载并聚焦完成后的回调:父层用它把笔记流的滚动位置还原到进编辑之前 */
  onMounted?: () => void;
  /** 点区块外且落点是另一条笔记正文:先保存当前(成功才)再切过去 */
  onSwitchNote?: (id: number) => void;
  /** 面板已卸载、无法就地显示错误时:错误交主窗错误条,不能让失败静默 */
  onErrorFallback?: (message: string) => void;
}

/** 提交结果:ok 为假时 message 是中文原因;inline = 面板内已经显示过(卸载时才需要转交);
 *  ok 为真时 changed 表示是否真的写了库(未变 = 没写,调用方需自行退出编辑) */
// busy: 已有保存在飞,本次点击被忽略(调用方不提示、不退出、不切笔记)
type CommitResult =
  | { ok: true; changed: boolean }
  | { ok: false; message: string; inline: boolean; busy?: boolean };

/** 编辑态:点正文即就地变源码框(形态 A,2026-09-21;分屏实时预览已退场)。
 *  提交判定(2026-09-21 起):点区块内 = 继续编辑,点区块外 = 保存(未变则不写库直接退出),
 *  点另一条笔记正文 = 先存后进;Esc = 取消(与取消按钮同义);Ctrl+Enter / 保存按钮不变。 */
export function EditPanel(p: EditPanelProps): ReactNode {
  // 决策:note.content 是已剥离标签的正文;编辑源码补回 '#标签' 尾缀,
  // 与输入栏捕获语法一致(用户可看/改标签),保存时后端重新剥离归类。
  const [source, setSource] = useState(() => composeSource(p.note.content, p.note.tags));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 标签数实时化:输入变化后 250ms 防抖调后端命令 parse_note_source(与保存路径同源),
  // 尚未返回/失败时回退已保存标签数(不闪烁成 0);顺序守卫与去抖细节见 use-source-tags.ts。
  // 纯建议层:保存行为与校验完全不受影响。
  const tagCount = useSourceTagCount(source, p.note.tags.length);
  const hint = tagCountHint(tagCount);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLLIElement>(null);
  /** 挂载时的源码:点区块外时与它比较,内容未变就不写库 */
  const initial = useRef(source);
  const alive = useRef(true);
  /** 已有保存在飞(区块外连点 / 点另一条笔记时的重复提交守卫) */
  const inFlight = useRef(false);

  // R4:进编辑**不改动笔记流的滚动位置**。原先用 autoFocus,浏览器聚焦时会做 scrollIntoView ——
  // 被视口裁掉的卡片一旦点进编辑,流 scrollTop 就被拉回去(实测 200 -> 0,跳 200px)。
  // 改成显式 focus + preventScroll:焦点照样落在源码框(键盘可达性与 Ctrl+Enter 不变),
  // 但不向任何滚动祖先请求“把焦点元素滚进视野”。
  useEffect(() => {
    alive.current = true;
    boxRef.current?.focus({ preventScroll: true });
    p.onMounted?.(); // 焦点落定后再还原流位置
    return () => {
      alive.current = false;
    };
  }, []);

  /** 真正写库;失败留在编辑态并给中文原因 */
  const commit = async (text: string): Promise<CommitResult> => {
    setSaving(true);
    setError('');
    inFlight.current = true;
    try {
      const updated = await api.updateNote(p.note.id, text);
      if (updated) {
        p.onSaved(updated); // 保存成功后的就地刷新与退出编辑由 onSaved 负责
        return { ok: true, changed: true };
      }
      p.onCancel(); // 笔记已被并发删除:静默退出编辑
      return { ok: true, changed: false };
    } catch (e) {
      const message = '保存失败: ' + String(e);
      setError(message);
      // 面板还活着就地显示;已被卸载(例如点侧栏导致卸载)时交给主窗错误条,不能静默(复审 C1)
      return { ok: false, message, inline: alive.current };
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  /** 显式保存(Ctrl+Enter / 保存按钮):空内容拒绝并就地给中文错误 */
  const save = async (): Promise<CommitResult> => {
    if (saving || inFlight.current) {
      setError('正在保存,请稍候');
      return { ok: false, message: '正在保存,请稍候', inline: alive.current, busy: true };
    }
    const text = prepareForSave(source);
    if (text === null) {
      setError('内容不能为空');
      return { ok: false, message: '内容不能为空', inline: true };
    }
    return commit(text);
  };

  /** 点区块外/切走时的提交:内容未变 -> 直接退出不写库;否则同显式保存 */
  const flush = useCallback(async (): Promise<CommitResult> => {
    // 已有保存在飞:忽略这次点击(否则连点两次区块外会发两次 updateNote,复审 I1)
    if (inFlight.current) return { ok: false, message: '正在保存,请稍候', inline: alive.current, busy: true };
    const text = prepareForSave(source);
    if (text === null) {
      setError('内容不能为空');
      return { ok: false, message: '内容不能为空', inline: alive.current };
    }
    if (text === prepareForSave(initial.current)) return { ok: true, changed: false }; // 未变:no-op
    return commit(text);
  }, [source, p]);

  // 离开编辑区块 = 保存(点区块外 / 点到程序窗口外):两条通道都在 useLeaveSave 里
  useLeaveSave({
    panelRef,
    flush,
    onSwitchNote: p.onSwitchNote,
    onCancel: p.onCancel,
    onErrorFallback: p.onErrorFallback,
    shouldEnterEdit,
  });

  return (
    <li
      ref={panelRef}
      data-testid="edit-panel"
      // Esc = 取消(与取消按钮同义):焦点在源码框或本面板任一按钮上都能收起编辑
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          p.onCancel();
        }
      }}
      className="border-b border-accent/40 bg-accent-soft/40 px-4 py-3"
    >
      <textarea
        ref={boxRef}
        aria-label="编辑源码"
        rows={editRows(source)}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        className="scroll-gutter w-full resize-y rounded-md border border-border bg-raised p-2 font-mono text-sm leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted" data-testid="edit-tag-count">
            {tagCountLabel(tagCount)}
            {hint !== null && <span className="ml-2 text-faint">{hint}</span>}
          </span>
          <span className="text-xs text-danger">{error || 'Ctrl+Enter 保存'}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={p.onCancel}
            className="rounded-md border border-border px-3 py-1 text-sm text-muted hover:bg-hover"
          >
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={!source.trim() || saving}
            className="rounded-md bg-accent px-3 py-1 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </li>
  );
}
