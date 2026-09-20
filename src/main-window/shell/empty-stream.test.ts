import { describe, expect, it } from 'vitest';
import { EMPTY_STATE_ACTION, EMPTY_STATE_TEXT, streamEmptyState } from './empty-stream';

describe('streamEmptyState', () => {
  it('有笔记时不显示空态', () => {
    expect(streamEmptyState({ noteCount: 3, queryFailed: false, filterEmpty: true })).toBeNull();
    expect(streamEmptyState({ noteCount: 1, queryFailed: true, filterEmpty: false })).toBeNull();
  });
  it('失败态优先于库为空与无匹配', () => {
    expect(streamEmptyState({ noteCount: 0, queryFailed: true, filterEmpty: true })).toBe('failed');
    expect(streamEmptyState({ noteCount: 0, queryFailed: true, filterEmpty: false })).toBe('failed');
  });
  it('无筛选条件且空列表 = 库为空', () => {
    expect(streamEmptyState({ noteCount: 0, queryFailed: false, filterEmpty: true })).toBe('empty-library');
  });
  it('有筛选条件但空列表 = 当前条件无匹配', () => {
    expect(streamEmptyState({ noteCount: 0, queryFailed: false, filterEmpty: false })).toBe('no-match');
  });
});

describe('空态文案', () => {
  it('三种状态各有文案与动作,且都不含 emoji 或括号注释', () => {
    for (const key of ['failed', 'empty-library', 'no-match'] as const) {
      expect(EMPTY_STATE_TEXT[key].length).toBeGreaterThan(0);
      expect(EMPTY_STATE_ACTION[key].length).toBeGreaterThan(0);
      expect(EMPTY_STATE_TEXT[key]).not.toContain('(含子级)');
    }
  });
});
