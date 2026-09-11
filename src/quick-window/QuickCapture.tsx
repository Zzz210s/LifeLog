import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { prepareForSave } from '../shared/note-source';
import type { Note } from '../shared/types';
import { wheelZoom } from '../shared/zoom';
import { HeaderControls } from './HeaderControls';

/** 输入区最多长到 5 行,再多转内部滚动(搜索栏规格) */
const MAX_LINES = 5;

export function QuickCapture() {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pinned, setPinned] = useState(true);
  const [focused, setFocused] = useState(false);
  const zoomRef = useRef(1);
  const zoomTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api
      .getSetting('quick_always_on_top')
      .then((v) => setPinned(v !== 'false')) // 与 Rust show() 的持久化置顶状态同步;null 视为 true
      .catch(() => {});
    void api
      .getSetting('quick_zoom')
      .then((z) => {
        const v = z ? Number(z) : 1;
        zoomRef.current = v;
        setZoom(v);
      })
      .catch(() => {});
  }, []);

  // 裸滚轮缩放(贴纸式,固定行为);目标处于可滚动容器内时深先滚动内容
  // 同一 effect 兼顾窗口级 Esc:焦点在 BODY 时 textarea 上的 keydown 收不到,
  // 会导致点空白后 Esc 隐藏失效,故提升到 window 级
  useEffect(() => {
    const inScrollable = (t: EventTarget | null): boolean => {
      for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight) return true;
      }
      return false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (inScrollable(e.target)) return;
      e.preventDefault();
      const next = wheelZoom(zoomRef.current, e.deltaY);
      if (next === zoomRef.current) return;
      zoomRef.current = next;
      setZoom(next);
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
      zoomTimer.current = window.setTimeout(() => void api.setZoom(next).catch(() => {}), 150);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return; // 输入法组合中不抢 Esc
      e.preventDefault();
      void api.hideQuickWindow();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  /** 单行起自动长高:先归零再按内容撑开;到 5 行封顶,超出由 overflow-y 内部滚动 */
  const resize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * MAX_LINES + pad + border;
    el.style.height = Math.min(el.scrollHeight + border, max) + 'px';
  }, []);

  const save = useCallback(async () => {
    const text = prepareForSave(content); // 只裁行尾空白:整条缩进代码块的首行缩进必须保留
    if (!text) return;
    try {
      const note = await api.saveQuickNote(text);
      setContent('');
      setError('');
      setSaved(note);
      // 保存成功收回单行
      if (inputRef.current) inputRef.current.style.height = 'auto';
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(String(e)); // 保存失败保留输入
    }
  }, [content]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Esc 由窗口级监听兜底(见上 effect),此处只处理 Ctrl+Enter
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };

  const togglePin = async () => {
    try {
      setPinned(await api.togglePin());
    } catch {
      /* 忽略 */
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white text-sm text-gray-800">
      <HeaderControls
        pinned={pinned}
        zoom={zoom}
        onTogglePin={togglePin}
        onHide={() => void api.hideQuickWindow()}
      />
      {/* min-h-0:窗口缩到极小时允许内容区收缩,不顶出/不产生窗口滚动条 */}
      <div
        className="relative flex min-h-0 flex-1 flex-col px-2 pt-1.5"
        // 点击空白区(非 textarea)时把焦点拉回输入框:否则焦点落到 BODY,
        // 提示条消失且窗口级 Esc 外的输入行为异常;preventDefault 避免先 blur 再 focus 抖动
        onMouseDown={(e) => {
          if (e.target === inputRef.current) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <textarea
          ref={inputRef}
          autoFocus
          rows={1}
          aria-label="快速输入内容"
          name="content"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="记点什么... #标签 自动归类"
          className="w-full resize-none overflow-y-auto rounded-2xl border border-gray-200 bg-white px-3 py-1.5 leading-relaxed outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        {focused && (
          <div className="pointer-events-none absolute inset-x-2 bottom-0 rounded-b-2xl bg-blue-50/95 px-3 py-1 text-xs text-blue-500">
            Ctrl+Enter 保存 · Esc 隐藏 · #标签 自动归类
          </div>
        )}
      </div>
      <div className="flex h-7 items-center justify-between px-3 text-xs">
        <span className={saved ? 'text-green-600' : 'text-gray-400'}>
          {saved
            ? `已保存 ${saved.created_at.slice(11, 16)}${
                saved.tags.length ? ' ' + saved.tags.map((t) => '#' + t).join(' ') : ''
              }`
            : error
              ? '保存失败: ' + error
              : ''}
        </span>
        <button onClick={() => void save()} className="text-blue-600 hover:underline">
          保存
        </button>
      </div>
    </div>
  );
}
