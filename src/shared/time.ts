/** DB 时间戳形状:`YYYY-MM-DD HH:MM:SS`(001_init.sql 用 datetime('now','localtime')) */
const STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;

/** 展示用时间戳:截到分钟 `YYYY-MM-DD HH:MM`;格式不符则原样返回(不抛错不丢内容) */
export function formatStamp(createdAt: string): string {
  const m = STAMP.exec(createdAt);
  return m ? `${m[1]} ${m[2]}` : createdAt;
}

/** `<time datetime>` 需要的 ISO 形式(空格分隔改 T);格式不符原样返回 */
export function toDateTimeAttr(createdAt: string): string {
  return STAMP.test(createdAt) ? createdAt.replace(' ', 'T') : createdAt;
}
