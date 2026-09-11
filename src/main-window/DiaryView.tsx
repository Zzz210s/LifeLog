import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { MiniCalendar } from './MiniCalendar';

/** 本地时区今天的 YYYY-MM-DD */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 日记:左月历右编辑器;按日一篇,保存打点,空正文允许 */
export function DiaryView(): ReactNode {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [weather, setWeather] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const refreshMarked = (y: number, m: number) => {
    void api
      .diaryDates(y, m)
      .then((dates) => setMarked(new Set(dates)))
      .catch((e) => setError(String(e)));
  };

  // 挂载 + 月份变化:刷新当月有记录日期
  useEffect(() => {
    refreshMarked(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // 选中日期变化:回填编辑器(无记录置空);快速切换时丢弃过期响应
  useEffect(() => {
    let cancelled = false;
    setSavedAt(null);
    void api
      .getDiary(selectedDate)
      .then((entry) => {
        if (cancelled) return;
        setTitle(entry?.title ?? '');
        setContent(entry?.content ?? '');
        setMood(entry?.mood ?? '');
        setWeather(entry?.weather ?? '');
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // 保存成功提示 2 秒后消失
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  const save = () => {
    void api
      .saveDiary({
        date: selectedDate,
        title,
        content,
        mood: mood || null,
        weather: weather || null,
      })
      .then((entry) => {
        setSavedAt(entry.updated_at.slice(11, 16));
        refreshMarked(year, month); // 当天可能首次有记录,圆点补上
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="px-6 py-4 text-lg font-semibold text-gray-800">日记</h1>
      {error && <div className="px-6 pb-2 text-xs text-red-500">{error}</div>}
      <div className="flex flex-1 overflow-hidden">
        <MiniCalendar
          year={year}
          month={month}
          marked={marked}
          selected={selectedDate}
          onSelect={setSelectedDate}
          onMonthChange={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
        />
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">{selectedDate}</span>
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
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
