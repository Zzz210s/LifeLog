import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { fetchViewHits } from './view-hits';

describe('fetchViewHits', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('成功:键值对转成命中表,命令名与参数正确', async () => {
    vi.mocked(invoke).mockResolvedValue([
      ['all', 9],
      ['todo', 2],
      ['untagged', 1],
      ['view:3', 4],
    ]);
    expect(await fetchViewHits()).toEqual({ all: 9, todo: 2, untagged: 1, 'view:3': 4 });
    expect(invoke).toHaveBeenCalledWith('count_view_hits');
  });

  it('失败:整体降级为空表(徽标逐个渲染「—」),不抛错、不上错误条', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('数据库正忙'));
    expect(await fetchViewHits()).toEqual({});
  });
});
