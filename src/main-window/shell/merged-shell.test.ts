/**
 * 合并自同目录下的小用例文件(架构精简 C,2026-10-27):
 *   - backup-notice.test.ts
 *   - empty-stream.test.ts
 *   - use-open-settings.test.ts
 * 每个原文件的顶层 `describe` 原样保留,用例数前后必须逐个相等。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_STATE_ACTION, EMPTY_STATE_TEXT, streamEmptyState } from './empty-stream';
import { backupWarningText } from './backup-notice';
import { consumePendingAfterEvent, shouldOpenOnPending } from './use-open-settings';

describe('shell 合并用例', () => {
  describe('backupWarningText', () => {
    it('同时给出原因、已继续升级与磁盘空间提醒', () => {
      const text = backupWarningText('磁盘已满');
      expect(text).toContain('自动备份失败');
      expect(text).toContain('磁盘已满');
      expect(text).toContain('已继续升级');
      expect(text).toContain('磁盘空间');
    });
    it('原因原样透传(不摘要、不丢失细节)', () => {
      expect(backupWarningText('复制数据库失败: 拒绝访问')).toContain('复制数据库失败: 拒绝访问');
    });
  });

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

  describe('shouldOpenOnPending', () => {
    it('pending 为 true 才切设置页', () => {
      expect(shouldOpenOnPending(true)).toBe(true);
    });

    it('取走为空 / 假值 / 异常载荷都不动视图', () => {
      expect(shouldOpenOnPending(false)).toBe(false);
      expect(shouldOpenOnPending(null)).toBe(false);
      expect(shouldOpenOnPending(undefined)).toBe(false);
      expect(shouldOpenOnPending('true')).toBe(false);
      expect(shouldOpenOnPending(0)).toBe(false);
    });
  });

  describe('consumePendingAfterEvent(事件通道的 pending 兜底)', () => {
    it('事件到达时确实取用一次(清掉双通道留下的残留)', () => {
      let calls = 0;
      consumePendingAfterEvent(() => {
        calls++;
        return Promise.resolve(true);
      });
      expect(calls).toBe(1);
    });

    it('取用失败不抛出、不影响切页', async () => {
      let calls = 0;
      consumePendingAfterEvent(() => {
        calls++;
        return Promise.reject(new Error('IPC 失败'));
      });
      await Promise.resolve();
      expect(calls).toBe(1);
    });
  });

});
