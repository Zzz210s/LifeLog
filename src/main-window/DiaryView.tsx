import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { MiniCalendar } from './MiniCalendar';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时区今天的 YYYY-MM-DD */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 编辑器四字段快照:fetch 回填/保存成功后记录,用于派生 dirty */
interface Fields {
  title: string;
  content: string;
  mood: string;
  weather: string;
}

const EMPTY: Fields = { title: '', content: '', mood: '', weather: '' };

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
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<Fields>(EMPTY);

  const dirty =
    title !== snapshot.title ||
    content !== snapshot.content ||
    mood !== snapshot.mood ||
    weather !== snapshot.weather;

  const refreshMarked = (y: number, m: number) => {
    void api
      .diaryDates(y, m)
      .then((dates) => setMarked(new Set(dates)))
      .catch((e) => setError(String(e)));
  };

  // 挂载 + 月份变化:刷新当月有记录日期
  useEffect(() => {
    refreshMarked(year, month);
  }, [year, month]);

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
      .getDiary(selectedDate)
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
  }, [selectedDate]);

  // 保存成功提示 2 秒后消失
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(null), 2000);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  // 翻月:有未保存修改先确认,取消则年月/选中均不动(日历保持原月);
  // 确认或本就干净 -> 年月与编辑器同步跳到新月份 1 号
  const changeMonth = (y: number, m: number) => {
    if (dirty && !window.confirm('当前修改尚未保存,切换月份将丢失,是否继续?')) {
      return;
    }
    setYear(y);
    setMonth(m);
    setSelectedDate(`${y}-${pad(m)}-01`);
  };

  const save = () => {
    if (!loaded || saving) return;
    setSaving(true);
    void api
      .saveDiary({
        date: selectedDate,
        title,
        content,
        mood: mood || null,
        weather: weather || null,
      })
      .then((entry) => {
        setError('');
        setSavedAt(entry.updated_at.slice(11, 16));
        setSnapshot({ title, content, mood, weather });
        refreshMarked(year, month); // 当天可能首次有记录,圆点补上
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false));
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
          onMonthChange={changeMonth}
        />
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">
              {selectedDate}
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
      </div>
    </div>
  );
}
