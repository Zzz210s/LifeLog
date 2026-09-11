import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';

/** 编辑器四字段快照:fetch 回填/保存成功后记录,用于派生 dirty */
interface Fields {
  title: string;
  content: string;
  mood: string;
  weather: string;
}

const EMPTY: Fields = { title: '', content: '', mood: '', weather: '' };

interface Props {
  date: string;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/** 日记编辑器:按日一篇;选中日期变化回填,保存打点 2 秒,空正文允许 */
export function DiaryEditor({ date, onSaved, onDirtyChange }: Props): ReactNode {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [weather, setWeather] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<Fields>(EMPTY);

  const dirty =
    title !== snapshot.title ||
    content !== snapshot.content ||
    mood !== snapshot.mood ||
    weather !== snapshot.weather;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // 选中日期变化:先清空四字段/打点/错误再回填,防止短暂显示上一日旧值;
  // loaded 仅在回填完成后为真,期间与请求失败时保存按钮禁用;快照随回填更新
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setTitle(EMPTY.title);
    setContent(EMPTY.content);
    setMood(EMPTY.mood);
    setWeather(EMPTY.weather);
    setSavedAt(null);
    setError('');
    void api
      .getDiary(date)
      .then((entry) => {
        if (cancelled) return;
        const next: Fields = {
          title: entry?.title ?? '',
          content: entry?.content ?? '',
          mood: entry?.mood ?? '',
          weather: entry?.weather ?? '',
        };
        setTitle(next.title);
        setContent(next.content);
        setMood(next.mood);
        setWeather(next.weather);
        setSnapshot(next);
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 保存成功提示 2 秒后消失
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  const save = () => {
    if (!loaded || saving) return;
    setSaving(true);
    void api
      .saveDiary({
        date,
        title,
        content,
        mood: mood || null,
        weather: weather || null,
      })
      .then((entry) => {
        setError('');
        setSavedAt(entry.updated_at.slice(11, 16));
        setSnapshot({ title, content, mood, weather });
        onSaved();
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
      {error && <div className="text-xs text-red-500">{error}</div>}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">
          {date}
          {!loaded && <span className="ml-2 text-xs text-gray-400">加载中</span>}
        </span>
        {savedAt && <span className="text-xs text-green-600">已保存 {savedAt}</span>}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题(可选)"
        className="rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
      />
      <div className="flex gap-3">
        <input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="心情"
          className="w-32 rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <input
          value={weather}
          onChange={(e) => setWeather(e.target.value)}
          placeholder="天气"
          className="w-32 rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="今天记点什么(正文中的 #标签 会单独归档)"
        className="min-h-40 flex-1 resize-none rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
      />
      <div>
        <button
          onClick={save}
          disabled={!loaded || saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>
    </div>
  );
}
