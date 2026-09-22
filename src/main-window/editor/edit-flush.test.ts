/** 编辑态 flush 通道的单测:没面板放行、成功放行、失败带中文原因不静默 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushEditing, hasEditingPanel, registerEditFlush } from './edit-flush';

afterEach(() => registerEditFlush(null));

describe('edit-flush:命令执行前的 flush 通道', () => {
  it('没有编辑面板时直接放行', async () => {
    expect(hasEditingPanel()).toBe(false);
    await expect(flushEditing()).resolves.toEqual({ ok: true });
  });

  it('登记后走登记的 flush;成功后注销即回到放行', async () => {
    const fn = vi.fn(async () => ({ ok: true }));
    registerEditFlush(fn);
    expect(hasEditingPanel()).toBe(true);
    await expect(flushEditing()).resolves.toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
    registerEditFlush(null);
    expect(hasEditingPanel()).toBe(false);
  });

  it('失败原样带出中文原因(调用方据此显示错误条,不静默)', async () => {
    registerEditFlush(async () => ({ ok: false, message: '内容不能为空' }));
    await expect(flushEditing()).resolves.toEqual({ ok: false, message: '内容不能为空' });
  });

  it('登记被替换时以最后一次为准(卸载注销不会误伤新面板)', async () => {
    const old = vi.fn(async () => ({ ok: false, message: '旧面板' }));
    const fresh = vi.fn(async () => ({ ok: true }));
    registerEditFlush(old);
    registerEditFlush(fresh);
    await expect(flushEditing()).resolves.toEqual({ ok: true });
    expect(old).not.toHaveBeenCalled();
  });
});
