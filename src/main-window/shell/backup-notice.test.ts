import { describe, expect, it } from 'vitest';
import { backupWarningText } from './backup-notice';

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
