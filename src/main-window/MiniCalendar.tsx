import type { ReactNode } from 'react';
import { buildMonthCells } from '../shared/calendar';

interface Props {
  /** 当前显示年月(受控:翻月请求交父级裁决,父级拒绝则日历不动) */
  year: number;
  month: number;
  marked: Set<string>;
  selected: string;
  onSelect: (date: string) => void;
  /** 点击翻月:请求切到新年月;父级确认后回写 props,取消则原样保持 */
  onMonthChange: (year: number, month: number) => void;
}

/** 周一为首的星期表头 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 月历:有记录日期带圆点,选中高亮,顶栏翻月;网格数学复用 shared/calendar */
export function MiniCalendar({
  year,
  month,
  marked,
  selected,
  onSelect,
  onMonthChange,
}: Props): ReactNode {
  const nav = (delta: number) => {
    let ny = year;
    let nm = month + delta;
    if (nm < 1) {
      nm = 12;
      ny -= 1;
    } else if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    onMonthChange(ny, nm);
  };

  const cells = buildMonthCells(year, month);

  return (
    <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => nav(-1)}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
        >
          上月
        </button>
        <span className="text-sm font-medium text-gray-700">
          {year}年{month}月
        </span>
        <button
          onClick={() => nav(1)}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
        >
          下月
        </button>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-xs text-gray-400">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`blank-${i}`} />;
          }
          const date = `${year}-${pad(month)}-${pad(day)}`;
          const isSelected = date === selected;
          const isMarked = marked.has(date);
          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              className={`relative mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs ${
                isSelected
                  ? 'bg-blue-600 font-medium text-white'
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
            >
              {day}
              {isMarked && !isSelected && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
