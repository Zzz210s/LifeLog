import { describe, expect, it } from 'vitest';
import { formatNoteTime } from './note-time';

describe('formatNoteTime(created_at -> MM-DD HH:MM)', () => {
  it('SQLite localtime 口径的完整时间戳取到分钟', () => {
    expect(formatNoteTime('2026-09-12 08:30:45')).toBe('09-12 08:30');
    expect(formatNoteTime('2026-01-02 23:59:59')).toBe('01-02 23:59');
  });

  it('容忍 T 分隔与毫秒(ISO 变体只取到分钟)', () => {
    expect(formatNoteTime('2026-09-12T08:30:45')).toBe('09-12 08:30');
    expect(formatNoteTime('2026-09-12 08:30:45.123')).toBe('09-12 08:30');
  });

  it('只到分钟的值也接受', () => {
    expect(formatNoteTime('2026-09-12 08:30')).toBe('09-12 08:30');
  });

  it('空值或不可解析的值返回空串(界面据此不渲染时间)', () => {
    expect(formatNoteTime('')).toBe('');
    expect(formatNoteTime('   ')).toBe('');
    expect(formatNoteTime('昨天')).toBe('');
    expect(formatNoteTime('2026/09/12 08:30')).toBe('');
  });
});
