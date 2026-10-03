/**
 * 编辑框内把**光标所在行**滚到"窗口正中央及上方"(用户 2026-10-03 的要求)。
 *
 * 难点(用户已指出):预览是渲染后的文本、编辑框里是源码,两者长度不同,而且每行长短不一,
 * 所以纵向位置只能**估算** —— 目标是让光标那一行落在框内约 1/3 高度处(即在正中线之上),
 * 而不是精确对齐。估算宁可偏保守:目标位置夹在 [0, scrollHeight - clientHeight],
 * 且用"换行数 × 行高"作为下界(长行折行后实际更低,只会更靠下、不会被丢出视野)。
 */
export interface CaretScrollInput {
  /** 光标前的字符数(源码偏移) */
  caret: number;
  /** 光标前的换行数 */
  newlinesBefore: number;
  /** 一行高度(px,来自计算样式) */
  lineHeight: number;
  /** 框的可视高度 */
  clientHeight: number;
  /** 框的滚动高度 */
  scrollHeight: number;
}

/** 目标 scrollTop:光标行落在框内约 1/3 高度处;越界夹到合法范围 */
export function caretScrollTop(o: CaretScrollInput): number {
  const { caret, newlinesBefore, lineHeight, clientHeight, scrollHeight } = o;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || clientHeight <= 0) return 0;
  const max = Math.max(0, scrollHeight - clientHeight);
  // 行号下界 = 换行数(精确);不换行文本的上界 = 字符数。取两者中更小者作为估算行号,
  // 偏差方向是"滚得少一点",再由夹取保证光标仍在视野内。
  const lines = Math.min(Math.max(newlinesBefore, 0), Math.max(caret, 0));
  const offset = lines * lineHeight - clientHeight / 3;
  return Math.max(0, Math.min(max, Math.round(offset)));
}
