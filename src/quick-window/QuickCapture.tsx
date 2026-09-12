import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { prepareForSave } from '../shared/note-source';
import { savedStamp, shouldShowStamp } from '../shared/quick-feedback';
import { wheelZoom } from '../shared/zoom';

export function QuickCapture() {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const zoomRef = useRef(1);
  const zoomTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api
      .getSetting('quick_zoom')
      .then((z) => {
        zoomRef.current = z ? Number(z) : 1;
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

  const save = useCallback(async () => {
    const text = prepareForSave(content); // 只裁行尾空白:整条缩进代码块的首行缩进必须保留
    if (!text) return;
    try {
      await api.saveQuickNote(text);
      setContent('');
      setError('');
      setStamp(savedStamp(new Date()));
      setSavedAt(Date.now());
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSavedAt(0), 1500);
      inputRef.current?.focus(); // 保存后光标留在输入框,可继续记下一条
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

  return (
    <div className="relative flex h-screen w-full flex-col">
      <textarea
        ref={inputRef}
        autoFocus
        aria-label="快速输入内容"
        name="content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="记点什么... #标签 自动归类"
        className="h-full w-full flex-1 resize-none border-0 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none"
      />
      {error ? (
        <span className="pointer-events-none absolute right-3 bottom-2 text-xs text-red-500">
          保存失败: {error}
        </span>
      ) : shouldShowStamp(savedAt, Date.now()) ? (
        <span className="pointer-events-none absolute right-3 bottom-2 text-xs text-gray-400">
          {stamp}
        </span>
      ) : null}
    </div>
  );
}
