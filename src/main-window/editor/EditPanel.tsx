import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { composeSource, prepareForSave } from '../../shared/note-source';
import type { Note } from '../../shared/types';
import { updateNote } from '../data/note-writes';
import { shouldEnterEdit } from '../stream/body-click';
import { tagCountHint, tagCountLabel } from './edit-tag-count';
import { editRows } from './textarea-rows';
import { useSourceTagCount } from './use-source-tags';
import { registerEditFlush } from './edit-flush';
import { useLeaveSave } from './use-leave-save';
import { useSaveOnUnmount } from './use-save-on-unmount';

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
 *  提交判定(2026-09-21 二次修订):点区块内 = 继续编辑;点区块外 / 点到程序窗口外 / 切到另一条笔记 = 保存
 *  (未变则不写库直接退出);Esc = 取消(与取消按钮同义);**键盘保存(Ctrl+Enter)已按用户要求删除**。
 *
 *  源码框是**非受控**的:真实输入法(中文 IME)组合期间受控 `value` 的 React state 不会跟上,
 *  "点区块外保存"会拿旧 state 与初值比较、判成"未变"而静默丢弃刚打的字(2026-09-21 实测)。
 *  故与输入栏同一套做法:DOM 是唯一真源,保存一律读 `boxRef.current.value`,state 只作派生 UI 用。 */
export function EditPanel(p: EditPanelProps): ReactNode {
  // 决策:note.content 是已剥离标签的正文;编辑源码补回 '#标签' 尾缀,保存时后端重新剥离归类。
  const [source, setSource] = useState(() => composeSource(p.note.content, p.note.tags));
  const [error, setError] = useState('');
  // 标签数实时化:输入变化后 250ms 防抖调后端命令 parse_note_source(与保存路径同源),
  // 尚未返回/失败时回退已保存标签数(不闪烁成 0);顺序守卫与去抖细节见 use-source-tags.ts。
  // 纯建议层:保存行为与校验完全不受影响。
  const tagCount = useSourceTagCount(source, p.note.tags.length);
  const hint = tagCountHint(tagCount);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  /** 保存时读的文本:非受控框的 DOM 值(含输入法组合中的字),拿不到才回退镜像。
   *  必须 useCallback 稳定身份 —— 它被卸载兜底 hook 当依赖,身份一变 effect 就重跑、
   *  其 cleanup 会在每次渲染时误触发一次兜底保存(实测:同一动作写库两次)。 */
  const currentText = useCallback((): string => boxRef.current?.value ?? domText.current, []);
  const domText = useRef(source); // DOM 文本镜像(卸载时 DOM 可能读不到,靠它兜底保存)
  const saved = useRef(false); // 已成功写库:卸载兜底不重复保存
  const cancelled = useRef(false); // 主动取消(Esc/取消按钮):卸载兜底不保存
  const panelRef = useRef<HTMLLIElement>(null);
  const initial = useRef(source); // 挂载时的源码:与它相同即「未变」,不写库
  const alive = useRef(true);
  /** 已有保存在飞(区块外连点 / 点另一条笔记时的重复提交守卫) */
  const inFlight = useRef(false);

  // R4:进编辑**不改动笔记流的滚动位置**。原先用 autoFocus,浏览器聚焦时会做 scrollIntoView ——
  // 被视口裁掉的卡片一旦点进编辑,流 scrollTop 就被拉回去(实测 200 -> 0,跳 200px)。
  // 改成显式 focus + preventScroll:焦点照样落在源码框(键盘仍可直接打字),
  // 但不向任何滚动祖先请求“把焦点元素滚进视野”。
  useEffect(() => {
    alive.current = true;
    const el = boxRef.current;
    el?.focus({ preventScroll: true });
    // 光标落在正文末尾(标签行之前):否则直接打字会把字并进末行 #标签,正文看起来没变
    const cut = el?.value.lastIndexOf(String.fromCharCode(10)) ?? -1;
    const caret = el ? (cut > 0 ? cut : el.value.length) : 0;
    el?.setSelectionRange(caret, caret);
    p.onMounted?.(); // 焦点落定后再还原流位置
    return () => {
      alive.current = false;
    };
  }, []);

  // 卸载兜底:任何离开方式都要把已改内容写库(见 use-save-on-unmount.ts 的说明)
  useSaveOnUnmount({ noteId: p.note.id, initial, getText: currentText, saved, cancelled });

  /** 真正写库;失败留在编辑态并给中文原因 */
  const commit = async (text: string): Promise<CommitResult> => {
    setError('');
    inFlight.current = true;
    try {
      const updated = await updateNote(p.note.id, text);
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
    }
  };

  /** 点区块外 / 切走 / 窗口失焦时的提交:读 DOM 值,内容未变 -> 直接退出不写库;否则同显式保存 */
  const flush = useCallback(async (): Promise<CommitResult> => {
    // 已有保存在飞:忽略这次点击(否则连点两次区块外会发两次 updateNote,复审 I1)
    if (inFlight.current) return { ok: false, message: '正在保存,请稍候', inline: alive.current, busy: true };
    const text = prepareForSave(currentText());
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

  // 命令面板执行前先 flush 编辑态(设计 §3.2):登记的就是上面那条 flush(同一保存通道)。
  // 用 ref 取最新实现,effect 只挂一次 —— flush 身份随输入变化,直接进依赖会反复注销/登记。
  const latestFlush = useRef(flush);
  latestFlush.current = flush;
  useEffect(() => {
    registerEditFlush(async () => {
      const r = await latestFlush.current();
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    });
    return () => registerEditFlush(null);
  }, []);

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
        defaultValue={source}
        // 输入/组合结束都把 DOM 值同步进 state(仅供派生 UI);保存永远读 DOM,故 IME 组合中也不会丢字
        onChange={(e) => {
          domText.current = e.target.value;
          setSource(e.target.value);
        }}
        onCompositionEnd={(e) => {
          domText.current = (e.target as HTMLTextAreaElement).value;
          setSource(domText.current);
        }}
        className="scroll-gutter w-full resize-y rounded-md border border-border-strong bg-raised p-2 font-mono text-body"
      />
      {/* 保存/取消按钮与「点其他位置即保存」提示已按用户要求删除:离开区块(点别处/切条目/失焦)即保存,Esc 取消 */}
      <div className="mt-2 flex items-center gap-3">
        <span className="text-xs text-muted" data-testid="edit-tag-count">
          {tagCountLabel(tagCount)}
          {hint !== null && <span className="ml-2 text-faint">{hint}</span>}
        </span>
        {error !== '' && <span className="text-xs text-danger">{error}</span>}
      </div>
    </li>
  );
}
