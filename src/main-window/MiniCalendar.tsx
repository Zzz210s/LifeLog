import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  /** 初始年月(仅作初值:年月导航状态由日历内部持有) */
  year: number;
  month: number;
  marked: Set<string>;
  selected: string;
  onSelect: (date: string) => void;
  /** 内部翻月时通知父级(父级据此刷新当月 marked) */
  onMonthChange?: (year: number, month: number) => void;
}

/** 周一为首的星期表头 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 某月天数:Date 日期参数 0 = 上月末日 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 该月 1 号的周一制偏移(周一=0):getDay() 周日=0,折算 (day+6)%7 */
function firstDayOffset(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/** 月历:有记录日期带圆点,选中高亮,顶栏翻月 */
export function MiniCalendar({
  year,
  month,
  marked,
  selected,
  onSelect,
  onMonthChange,
}: Props): ReactNode {
  const [y, setY] = useState(year);
  const [m, setM] = useState(month);

  const nav = (delta: number) => {
    let ny = y;
    let nm = m + delta;
    if (nm < 1) {
      nm = 12;
      ny -= 1;
    } else if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    setY(ny);
    setM(nm);
    onMonthChange?.(ny, nm);
  };

  const offset = firstDayOffset(y, m);
  const total = daysInMonth(y, m);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

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
          {y}年{m}月
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
          const date = `${y}-${pad(m)}-${pad(day)}`;
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
