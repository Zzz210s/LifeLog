/** 月历纯数学:周一为首,零依赖,便于单测 */

/** 某月天数:Date 日期参数 0 = 上月末日 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 该月 1 号的周一制偏移(周一=0):getDay() 周日=0,折算 (day+6)%7 */
export function firstWeekdayOffset(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/** 月网格:前置 null 补齐偏移 + 当月日号 1..daysInMonth */
export function buildMonthCells(year: number, month: number): (number | null)[] {
  const offset = firstWeekdayOffset(year, month);
  const total = daysInMonth(year, month);
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
}
