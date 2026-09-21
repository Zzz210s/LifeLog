// @vitest-environment jsdom
/**
 * 拖拽兜底与落库映射证据(T6/T8 + 落库命令):
 * dragend/窗口 pointerup 清干净(残留热点为 0)、根级 no-op 不写库不回执、
 * 各分区 → move_tag / move_tag_beside 的参数与「新路径」回执。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDrag } from './drag-harness';
import type { MountedDrag } from './drag-harness';

const { moveTag, moveTagBeside } = vi.hoisted(() => ({ moveTag: vi.fn(), moveTagBeside: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { moveTag, moveTagBeside } }));

let h: MountedDrag;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  moveTag.mockReset();
  moveTagBeside.mockReset();
  moveTag.mockResolvedValue(undefined);
  moveTagBeside.mockResolvedValue(undefined);
  h = mountDrag();
});

afterEach(() => {
  h.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('T6 拖拽态兜底清理(不留残留热点)', () => {
  it('dragend 清掉源标记与全部悬停反馈', () => {
    h.startDrag();
    h.fire(h.row('生活'), 'dragover');
    expect(h.over()).toBe('生活:child');
    h.fire(h.row('工作/项目B'), 'dragend');
    expect(h.meta()).toBe('false||false|false');
    expect(h.over()).toBe('');
  });

  it('窗口 pointerup(拖拽被打断)同样清干净', () => {
    h.startDrag();
    h.fire(h.row('生活'), 'dragover');
    h.advance(300); // 悬停过一会儿再被打断
    h.pointerUp();
    expect(h.meta()).toBe('false||false|false');
    expect(h.over()).toBe('');
  });

  it('拖拽结束(drop)后源标记与热区同步消失', () => {
    h.startDrag();
    h.fire(h.row('生活'), 'dragover');
    h.fire(h.row('生活'), 'drop');
    expect(h.meta()).toBe('false||false|false');
    expect(h.over()).toBe('');
  });
});

describe('T8 根级落点不再假成功', () => {
  it('源已在根级:不接受根级落点(无高亮),松手零写入零回执', () => {
    h.startDrag('生活');
    expect(h.meta().endsWith('false|false')).toBe(true); // rootAllowed = false
    h.fire(h.root(), 'dragover');
    expect(h.meta().endsWith('false|false')).toBe(true);
    h.fire(h.root(), 'drop');
    expect(moveTag).not.toHaveBeenCalled();
    expect(h.onMoved).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('源不在根级:接受并真的移动,回执带新路径', async () => {
    h.startDrag('工作/项目A');
    h.fire(h.root(), 'dragover');
    expect(h.meta().endsWith('true|true')).toBe(true);
    h.fire(h.root(), 'drop');
    await h.settled();
    expect(moveTag).toHaveBeenCalledWith(2, null);
    expect(h.onMoved).toHaveBeenCalledWith({ from: '工作/项目A', to: '项目A' });
  });
});

describe('落库命令映射与中文错误', () => {
  it('整行 = move_tag(成为子级);回执的新路径拼目标行', async () => {
    h.startDrag('工作/项目B');
    h.fire(h.row('生活'), 'dragover');
    h.fire(h.row('生活'), 'drop');
    await h.settled();
    expect(moveTag).toHaveBeenCalledWith(4, 5);
    expect(h.onMoved).toHaveBeenCalledWith({ from: '工作/项目B', to: '生活/项目B' });
  });

  it('边界带 = move_tag_beside(锚点 + after);回执的新路径按锚点父级派生', async () => {
    h.startDrag('工作/项目B');
    h.fire(h.band('upper:工作:after'), 'dragover');
    h.fire(h.band('upper:工作:after'), 'drop');
    await h.settled();
    expect(moveTagBeside).toHaveBeenCalledWith(4, 1, true);
    expect(h.onMoved).toHaveBeenCalledWith({ from: '工作/项目B', to: '项目B' });
  });

  it('后端拒绝:中文错误透传 onError(不静默)', async () => {
    moveTag.mockRejectedValue(new Error('该层级下已有同名标签'));
    h.startDrag('工作/项目B');
    h.fire(h.row('生活'), 'drop');
    await h.settled();
    expect(h.onError).toHaveBeenCalledWith('Error: 该层级下已有同名标签');
  });

  it('落点解析不出(原地不动)时连命令都不发', () => {
    h.startDrag('工作/项目B');
    h.fire(h.row('工作'), 'drop'); // 成为当前父级的子级 = 无变化
    expect(moveTag).not.toHaveBeenCalled();
    expect(moveTagBeside).not.toHaveBeenCalled();
  });
});
