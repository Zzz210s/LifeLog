import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { clampZoom } from '../shared/zoom';
import { HeaderControls } from './HeaderControls';
import { RecentList } from './RecentList';

export function QuickCapture() {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pinned, setPinned] = useState(true);
  const [showRecent, setShowRecent] = useState(false);
  const [recent, setRecent] = useState<Note[]>([]);
  const zoomRef = useRef(1);
  const zoomTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void api.listRecentNotes().then(setRecent).catch(() => {});
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

  // Ctrl+滚轮缩放(WebView2 zoom factor)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      const next = clampZoom(zoomRef.current + (e.deltaY < 0 ? 0.05 : -0.05));
      if (next === zoomRef.current) return;
      zoomRef.current = next;
      setZoom(next);
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
      zoomTimer.current = window.setTimeout(() => void api.setZoom(next).catch(() => {}), 150);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const save = useCallback(async () => {
    const text = content.trim();
    if (!text) return;
    try {
      const note = await api.saveQuickNote(text);
      setContent('');
      setError('');
      setSaved(note);
      setRecent((prev) => [note, ...prev.filter((n) => n.id !== note.id)].slice(0, 20));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(String(e)); // 保存失败保留输入
    }
  }, [content]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void api.hideQuickWindow();
    } else if (e.ctrlKey && e.key === 'Enter') {
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
    <div className="flex h-screen flex-col bg-white text-gray-800 text-sm">
      <HeaderControls
        pinned={pinned}
        zoom={zoom}
        onTogglePin={togglePin}
        onToggleRecent={() => setShowRecent((v) => !v)}
        onHide={() => void api.hideQuickWindow()}
      />
      <textarea
        autoFocus
        aria-label="快速输入内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="记录... 行内 #标签 自动归类;Ctrl+Enter 保存;Esc 隐藏"
        className="flex-1 resize-none px-3 py-2 outline-none bg-transparent leading-relaxed"
      />
      <div className="flex h-7 items-center justify-between px-3 text-xs">
        <span className={saved ? 'text-green-600' : 'text-gray-400'}>
          {saved
            ? `已保存${saved.tags.length ? ': ' + saved.tags.map((t) => '#' + t).join(' ') : ''}`
            : error
              ? '保存失败: ' + error
              : 'Ctrl+Enter 保存'}
        </span>
        <button onClick={() => void save()} className="text-blue-600 hover:underline">
          保存
        </button>
      </div>
      {showRecent && <RecentList notes={recent} onPick={(n) => setContent(n.content)} />}
    </div>
  );
}
