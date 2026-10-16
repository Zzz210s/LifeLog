import { useCallback, useRef, useState } from 'react';
import { api } from '../shared/api';
import { prepareForSave } from '../shared/note-source';
import { savedStamp } from '../shared/input-feedback';
import { useImeInput } from '../shared/use-ime-composition';
import { canEdit } from '../shared/input-lock';
import { useThemeMode } from '../shared/use-theme-mode';
import { useInputCompletions } from './use-input-completions';
import { InputBarOverlays } from './InputBarOverlays';
import { useAutoHeight } from './use-auto-height';
import { useHideShortcuts } from './use-hide-shortcuts';
import { useMinHeight } from './use-min-height';
import { useRootMouse } from './use-root-mouse';
import { useInputSettings } from './use-input-settings';
import { useStickerAppearance } from './use-sticker-appearance';
import { useInputWheel } from './use-input-wheel';
import { usePaletteSettings } from '../main-window/palette/use-palette-settings';

export function InputBar() {
  // 组合守卫:显示值 content 组合中照常跟随(非受控框的文字本来就在 DOM 里),补全候选只读
  // committed —— 否则拼音未上屏时 `#`/`[[` 候选已经按原始拼音收窄、还多打一次 IPC
  const { value: content, committed, setValue, handlers } = useImeInput();
  // 光标镜像(`[[` 补全的触发判断读它;`]]` 类语法要按光标切片,不能只看整串)
  const [caret, setCaret] = useState(0);
  // 笔记候选池的作废键:输入栏保存后自增,下一次 `[[` 会重取(否则新笔记不在池里)
  const [poolVersion, setPoolVersion] = useState(0);
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
    if (el) {
      el.value = next;
      el.setSelectionRange(next.length, next.length); // `el.value =` 后的落点跨浏览器不一致,显式落到末尾
    }
    setValue(next);
    setCaret(next.length);
  }, [setValue]);
  const { settings, lock, error, setError, unlock } = useInputSettings();
  // 最小高度下限(拖底边设置,基础逻辑像素;0 = 纯自动):有效高度 = max(自动, 下限)
  const { minHeight, applyMin, commitMin } = useMinHeight();
  // 首次使用引导的开窗由 Rust 启动路径做(前端建窗会卡主线程,见 windowing/startup.rs)
  // 主题:输入栏不写库,只跟随主窗广播(见 shared/use-theme-mode);窗口保持透明
  useThemeMode({ follow: true, onError: setError });
  const editing = canEdit(lock);
  const anyLock = lock.move || lock.close || lock.content;
  const stickerVars = useStickerAppearance().vars;
  // 补全装配(标签/链接各一套,`useInputCompletions` 里路由);固定项与标签 MRU 走主窗浮层同一份
  const palette = usePaletteSettings();
  const complete = useInputCompletions({
    textareaRef: inputRef,
    value: committed, // 组合中的原始拼音不进候选
    caret,
    onReplace: applyValue,
    palette,
    dataVersion: poolVersion,
  });
  // 建议列表(# 标签 / [[ 笔记二选一):像浏览器搜索框下方那样长在输入框正下方,窗口随之变高(高度不落库)
  const listHeight = complete.listHeight;
  // 内容变化后按真实换行行数(1-5 行)自动长高;滚轮缩放后手动再同步一次
  const syncHeight = useAutoHeight({
    textareaRef: inputRef,
    value: content,
    extraCss: listHeight,
    minHeight,
  });
  const { opacity, onMiddleDown, flushView } = useInputWheel({
    settings,
    onResized: syncHeight,
    onError: setError,
  });

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
      setPoolVersion((v) => v + 1); // 新笔记入库:作废笔记候选池,下次 `[[` 重取
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

  // 隐藏接线(Esc / 双击 / 输入栏隐藏事件)搬进 use-hide-shortcuts(本文件守 200 行上限)
  const { onDoubleClick } = useHideShortcuts({ lock, flushView, doubleClickAction: settings.doubleClickAction });

  // 根元素鼠标路由(中键/左右带/底边带/上下带)与「点一下才允许取焦点」都在这个 hook 里
  const onRootMouseDown = useRootMouse({
    lock,
    textareaRef: inputRef,
    onDoubleClick,
    onMiddleDown,
    applyMin,
    commitMin,
  });

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
      className="relative box-border flex h-screen w-full cursor-move flex-col p-[14px]"
      style={{ ...stickerVars, opacity: opacity / 100 }}
      onMouseDown={onRootMouseDown}
    >
      <textarea
        ref={inputRef}
        autoFocus
        defaultValue=""
        aria-label="输入栏内容"
        name="content"
        readOnly={!editing}
        onChange={(e) => {
          handlers.onChange(e.target.value, e.nativeEvent);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onCompositionEnd={(e) => {
          handlers.onCompositionEnd(e.currentTarget.value); // 上屏文本立即提交,补全据此搜一次
          setCaret(e.currentTarget.selectionStart ?? 0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="sticker-input min-h-0 w-full flex-1 resize-none overflow-y-auto px-3 py-2 text-sm leading-relaxed read-only:text-faint"
      />
      {complete.list}
      <InputBarOverlays
        anyLock={anyLock}
        onUnlock={onUnlock}
        error={error}
        stamp={stamp}
        savedAt={savedAt}
        editing={editing}
        now={Date.now()}
      />
    </div>
  );
}
