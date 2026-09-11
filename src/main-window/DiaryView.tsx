import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '../shared/api';
import { DiaryEditor } from './DiaryEditor';
import { MiniCalendar } from './MiniCalendar';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时区今天的 YYYY-MM-DD */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 日记页:左月历右编辑器,头部提供 Excel 导出(保存对话框选路径) */
export function DiaryView(): ReactNode {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  // 导出成功提示 2 秒后消失
  useEffect(() => {
    if (!exported) return;
    const id = window.setTimeout(() => setExported(false), 2000);
    return () => window.clearTimeout(id);
  }, [exported]);

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

  // 保存对话框选路径 -> 后端写 xlsx;取消对话框静默返回
  const onExport = async () => {
    if (exporting) return;
    const path = await save({
      defaultPath: '日记导出.xlsx',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    });
    if (!path) return;
    setExporting(true);
    try {
      await api.exportDiary(path);
      setError('');
      setExported(true);
    } catch {
      setError('导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-800">日记</h1>
        <div className="flex items-center gap-3">
          {exported && <span className="text-xs text-green-600">已导出</span>}
          <button
            onClick={() => void onExport()}
            disabled={exporting}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? '导出中' : '导出 Excel'}
          </button>
        </div>
      </div>
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
        <DiaryEditor
          date={selectedDate}
          onSaved={() => refreshMarked(year, month)}
          onDirtyChange={setDirty}
        />
      </div>
    </div>
  );
}
