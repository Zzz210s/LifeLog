const STAMP_MS = 1500;

export function savedStamp(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `已保存 ${hh}:${mm}`;
}

export function shouldShowStamp(shownAt: number, now: number, ms: number = STAMP_MS): boolean {
  if (shownAt <= 0) return false;
  return now - shownAt < ms;
}
