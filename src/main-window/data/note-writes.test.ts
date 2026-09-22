/**
 * 笔记写库唯一出口的单测(T6 修复轮 I2):**成功才**通知标签新鲜度。
 * 失败不通知(没写库就没有新标签,白刷一次全树 list_tags 没意义)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { deleteNote as removeNote, updateNote as writeNote } from './note-writes';

const { updateNote, deleteNote } = vi.hoisted(() => ({
  updateNote: vi.fn<() => Promise<Note | null>>(),
  deleteNote: vi.fn<() => Promise<void>>(),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, deleteNote } }));

const { notifyTagsChanged } = vi.hoisted(() => ({ notifyTagsChanged: vi.fn() }));
vi.mock('./tags-changed', () => ({ notifyTagsChanged }));

const note: Note = { id: 7, content: '买牛奶', created_at: '2026-09-22 10:00:00', tags: ['生活'] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('note-writes:写库出口', () => {
  it('更新成功 -> 通知标签新鲜度,并原样返回命令结果', async () => {
    updateNote.mockResolvedValue(note);
    await expect(writeNote(7, '买牛奶 #生活')).resolves.toBe(note);
    expect(updateNote).toHaveBeenCalledWith(7, '买牛奶 #生活');
    expect(notifyTagsChanged).toHaveBeenCalledTimes(1);
  });

  it('更新失败 -> 不通知,错误原样抛(不静默)', async () => {
    updateNote.mockRejectedValue(new Error('保存失败'));
    await expect(writeNote(7, '买牛奶')).rejects.toThrow(/保存失败/);
    expect(notifyTagsChanged).not.toHaveBeenCalled();
  });

  it('删除成功 -> 通知(链接计数与孤儿标签都可能变)', async () => {
    deleteNote.mockResolvedValue(undefined);
    await removeNote(7);
    expect(deleteNote).toHaveBeenCalledWith(7);
    expect(notifyTagsChanged).toHaveBeenCalledTimes(1);
  });

  it('删除失败 -> 不通知', async () => {
    deleteNote.mockRejectedValue(new Error('删除失败'));
    await expect(removeNote(7)).rejects.toThrow(/删除失败/);
    expect(notifyTagsChanged).not.toHaveBeenCalled();
  });
});
