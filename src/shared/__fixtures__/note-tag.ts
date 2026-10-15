/**
 * 测试夹具:一条标签线(前端 `NoteTag` 与 Rust `NoteTag` 同形)。
 * 无名字是常态(第二个参数省略即 `relationName: null`);有关系名的用例显式给名字,
 * 免得机械改造时把名字字段悄悄丢掉。
 */
import type { NoteTag } from '../types';

export const noteTag = (path: string, relationName: string | null = null): NoteTag => ({
  path,
  relationName,
});
