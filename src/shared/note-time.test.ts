import { describe, expect, it } from 'vitest';
import { formatNoteTime, timeDisplayKind } from './note-time';

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

describe('formatNoteTime 跨年不歧义(库内已有 2023-2026 的笔记)', () => {
  const now = new Date('2026-09-17T12:00:00');
  it('同年显示 MM-DD HH:MM', () => {
    expect(formatNoteTime('2026-01-02 23:59:59', now)).toBe('01-02 23:59');
  });
  it('非同年显示 YYYY-MM-DD(否则与同年同月日分不清)', () => {
    expect(formatNoteTime('2025-01-02 23:59:59', now)).toBe('2025-01-02');
    expect(formatNoteTime('2024-12-31 08:00:00', now)).toBe('2024-12-31');
  });
  it('timeDisplayKind 三态', () => {
    expect(timeDisplayKind('2026-01-02 08:00', now)).toBe('same-year');
    expect(timeDisplayKind('2023-01-02 08:00', now)).toBe('other-year');
    expect(timeDisplayKind('昨天', now)).toBe('invalid');
  });
});
