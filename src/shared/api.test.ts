/**
 * 关系线命令封装(计划 T4.1):`set_tag_relation` 的请求体形状**冻结不变**(第 3 参仍叫
 * `remark`,值 = 名字文本);新增 `rename_line_name` / `remove_line`。断言落到**真实**
 * `invoke` 的命令名与参数键(不是只断言封装存在)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { api } from './api';

describe('关系线命令封装', () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it('rename_line_name_hits_invoke:改名字点的名字', async () => {
    await api.renameLineName(7, '国别');
    expect(invoke).toHaveBeenCalledWith('rename_line_name', { nameId: 7, newName: '国别' });
  });

  it('remove_line_hits_invoke:按线 id 删一条具体的线', async () => {
    await api.removeLine(12);
    expect(invoke).toHaveBeenCalledWith('remove_line', { lineId: 12 });
  });

  it('set_tag_relation_request_shape_is_frozen:字段名仍是 remark,值 = 名字文本', async () => {
    await api.setTagRelation(1, 2, '国籍');
    expect(invoke).toHaveBeenCalledWith('set_tag_relation', { fromTag: 1, toTag: 2, remark: '国籍' });
  });

  it('set_tag_relation 传空串 = 清除名字(线回无名字线)', async () => {
    await api.setTagRelation(1, 2, '');
    expect(invoke).toHaveBeenCalledWith('set_tag_relation', { fromTag: 1, toTag: 2, remark: '' });
  });
});
