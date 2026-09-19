import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../shared/api';
import { prepareForSave } from '../shared/note-source';
import { savedStamp, shouldShowStamp } from '../shared/input-feedback';
import { canClose, canDrag, canEdit } from '../shared/input-lock';
import { useThemeMode } from '../shared/use-theme-mode';
import { useTagComplete } from './use-tag-complete';
import { TagCompleteList } from './TagCompleteList';
import { useDragBand } from './use-drag-band';
import { useWidthDrag } from './use-width-drag';
import { useAutoHeight } from './use-auto-height';
import { useInputSettings } from './use-input-settings';
import { useInputWheel } from './use-input-wheel';

export function InputBar() {
  const [content, setContent] = useState('');
  const [stamp, setStamp] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const saveTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 输入框是**非受控**的(不用 value prop):
  // 受控 + 元素级 input 监听(标签补全要读光标前的 # 词元)会互相揭短 —— 元素监听里的 setState
  // 会同步触发重渲染,把刚敲进去的字用陈旧的 state 写回 DOM,并让 React 的变化检测误判
  // “值未变”而根本不派发 onChange,结果就是“光标在、打不进字”(实测 2026-09-19:真实编辑管线
  // 打字时 React 的 _valueTracker 一次都没被调用,而 JS 设值 + 派发 input 却正常)。
  // 程序化写入(保存后清空、采纳补全)必须同时改 DOM 与 state,统一走 applyValue
  const applyValue = useCallback((next: string) => {
    const el = inputRef.current;
    if (el) el.value = next;
    setContent(next);
  }, []);
  const { settings, lock, error, setError, unlock } = useInputSettings();
  // 主题:输入栏不写库,只跟随主窗广播(见 shared/use-theme-mode);窗口保持透明
  useThemeMode({ follow: true, onError: setError });
  const editing = canEdit(lock);
  const anyLock = lock.move || lock.close || lock.content;
  // # 标签补全:词元拉候选、↑↓/Enter/Tab/Esc 路由;Ctrl+Enter 保存不受影响
  const complete = useTagComplete({ textareaRef: inputRef, value: content, onReplace: applyValue });
  // 内容变化后按真实换行行数(1-5 行)自动长高;滚轮缩放后手动再同步一次
  const syncHeight = useAutoHeight({ textareaRef: inputRef, value: content });
  const { opacity, onMiddleDown, flushView } = useInputWheel({
    settings,
    onResized: syncHeight,
    onError: setError,
  });

  // 页面自己发起的隐藏(Esc/双击)先 flush 视图状态再隐藏:窗口隐藏后页面计时器可能被冻结,
  // 节流中的透明度就永远落不了库;Rust 侧隐藏(热键/托盘/失焦)由下面的 input-hiding 事件兜底。
  const hideNow = useCallback(() => {
    flushView();
    void api.hideInputBar();
  }, [flushView]);

  // Rust 侧隐藏(热键/托盘/失焦自动隐藏)在 w.hide() 前会发出 input-hiding:
  // hide() 不触发 onFocusChanged(实测),隐藏后页面计时器还可能被冻结,页面自己发起的
  // 隐藏(Esc/双击)已由 hideNow 先 flush,热键/托盘路径靠这个事件补上最后一次 flush。
  // 残留风险:事件送达与页面处理都是异步的,页面若已被挂起仍可能漏掉(非 100% 可靠)。
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen('input-hiding', () => flushView())
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {}); // 订阅失败不阻断隐藏流程
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [flushView]);

  // 窗口级 Esc:焦点在 BODY 时 textarea 上的 keydown 收不到,
  // 会导致点空白后 Esc 隐藏失效,故提升到 window 级
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return; // 输入法组合中不抢 Esc
      e.preventDefault();
      if (!canClose(lock)) return; // 阻止关闭:Esc 无效(托盘菜单仍可隐藏)
      hideNow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock, hideNow]);

  // 右下角浮层:保存/解锁的短暂提示共用同一计时器
  const flash = useCallback((text: string) => {
    setStamp(text);
    setSavedAt(Date.now());
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => setSavedAt(0), 1500);
  }, []);

  const save = useCallback(async () => {
    // 非受控:正文以 DOM 为准(状态只是镜像),读取点必须取 DOM 值
    const text = prepareForSave(inputRef.current?.value ?? content);
    if (!text) return;
    try {
      await api.saveInputNote(text);
      applyValue('');
      setError('');
      flash(savedStamp(new Date()));
      inputRef.current?.focus(); // 保存后光标留在输入框,可继续记下一条
    } catch (e) {
      setError(`保存失败: ${String(e)}`); // 保存失败保留输入
    }
  }, [content, applyValue, flash, setError]);

  const onUnlock = useCallback(async () => {
    try {
      await unlock(); // 事务写库成功后才翻转本地锁定态(见 use-input-settings)
      setError('');
      flash('已解锁');
      inputRef.current?.focus(); // 解锁后回到输入框
    } catch (e) {
      setError(`解锁失败: ${String(e)}`); // 写库失败:保持锁定并复用错误浮层,不谎报已解锁
    }
  }, [unlock, flash, setError]);

  const onDoubleClick = useCallback(() => {
    if (settings.doubleClickAction !== 'hide' || !canClose(lock)) return;
    hideNow();
  }, [settings.doubleClickAction, lock, hideNow]);

  const onMouseDown = useDragBand({ locked: !canDrag(lock), onDoubleClick });
  const onWidthMouseDown = useWidthDrag({ textareaRef: inputRef, onDoubleClick });
  // 中键恢复视图 -> 左右带优先(双击或宽度拖动)-> 其余交给上下带(双击或移动窗口)
  const onRootMouseDown = (e: React.MouseEvent) => {
    if (onMiddleDown(e)) return;
    if (onWidthMouseDown(e)) return;
    onMouseDown(e);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 补全先拿键(返回 true 表示已消费);Esc 由窗口级监听兜底,此处只处理 Ctrl+Enter
    if (complete.onKeyDown(e)) return;
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (!editing) return; // 锁定内容:不保存
      void save();
    }
  };

  return (
    <div
      className="relative box-border h-screen w-full cursor-move p-[14px]"
      style={{ opacity: opacity / 100 }}
      onMouseDown={onRootMouseDown}
    >
      <textarea
        ref={inputRef}
        autoFocus
        defaultValue=""
        aria-label="输入栏内容"
        name="content"
        readOnly={!editing}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        className="sticker-input h-full w-full resize-none overflow-y-auto bg-raised px-3 py-2 text-sm leading-relaxed text-text read-only:text-faint"
      />
      {complete.open && (
        <TagCompleteList
          items={complete.items}
          activeIndex={complete.activeIndex}
          onPick={complete.onPick}
        />
      )}
      {anyLock ? (
        <button
          type="button"
          aria-label="解除锁定"
          title="解除锁定"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onUnlock}
          className="absolute top-4 right-4 flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M5 7V5.5a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="3.5" y="7" width="9" height="6" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      ) : null}
      {error ? (
        // 长错误(如路径/原始异常)不再从左侧被裁掉前缀:限宽(max 窗口宽-两侧各 1rem)并省略尾部
        <span className="pointer-events-none absolute right-4 bottom-4 max-w-[calc(100%-2rem)] truncate text-xs text-danger">
          {error}
        </span>
      ) : shouldShowStamp(savedAt, Date.now()) ? (
        <span className="pointer-events-none absolute right-4 bottom-4 text-xs text-faint">
          {stamp}
        </span>
      ) : !editing ? (
        <span className="pointer-events-none absolute right-4 bottom-4 text-xs text-faint">
          内容已锁定
        </span>
      ) : null}
    </div>
  );
}
