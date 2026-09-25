// @vitest-environment jsdom
/**
 * 拖拽状态机证据(T3/T4/T7/T2):落点解析、指示线条数、防抖、悬停自动展开。
 * 夹具与事件合成手法见 __fixtures__/drag-harness.tsx(页面内合成 DragEvent,不碰 OS 鼠标)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDrag } from './__fixtures__/drag-harness';
import type { MountedDrag } from './__fixtures__/drag-harness';

const { moveTag, moveTagBeside } = vi.hoisted(() => ({ moveTag: vi.fn(), moveTagBeside: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { moveTag, moveTagBeside } }));

let h: MountedDrag;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('requestAnimationFrame', () => 1); // 自动滚动另有时序测试,这里不跑帧循环
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

describe('T3 分区模型:整行 = 成为子级 / 边界带对半 = 同级插入', () => {
  it('dragstart 记录源;整行悬停 = 成为其子级', () => {
    h.startDrag();
    expect(h.meta()).toBe('true|工作/项目B|true|false');
    h.fire(h.row('生活'), 'dragover');
    expect(h.over()).toBe('生活:child');
  });

  it('行元素收到的落点一律是 child:整行 = 成为子级(边界带由 TagDropBand 单独接管)', () => {
    h.startDrag();
    for (const y of [100, 104, 110, 118]) h.fire(h.row('生活'), 'dragover', 10, y);
    expect(h.over()).toBe('生活:child');
  });

  it('边界带跨层级:上半 = 上一行之后、下半 = 下一行之前;一次只点亮一条', () => {
    h.startDrag('工作/项目B');
    h.fire(h.band('upper:工作:after'), 'dragover');
    expect(h.over()).toBe('工作:after');
    expect(h.host.querySelectorAll('[data-active="true"]').length).toBe(1);
    h.fire(h.band('lower:工作/项目A:before'), 'dragover');
    expect(h.over()).toBe('工作/项目A:before');
    expect(h.host.querySelectorAll('[data-active="true"]').length).toBe(1);
  });

  it('同一父级的相邻两行:上下两半归一化成同一落点(指针越过中线不跳)', () => {
    h.startDrag('生活');
    h.fire(h.band('upper:工作/项目B:before'), 'dragover');
    expect(h.over()).toBe('工作/项目B:before');
    h.fire(h.band('lower:工作/项目B:before'), 'dragover');
    expect(h.over()).toBe('工作/项目B:before');
  });
});

describe('T4 无效目标冒泡 / 原地不动不反馈', () => {
  it('悬停当前父级(项目B 移到工作下)= 无变化:不反馈、松手不写库', () => {
    h.startDrag();
    h.fire(h.row('工作'), 'dragover');
    expect(h.over()).toBe('');
    h.fire(h.row('工作'), 'drop');
    expect(moveTag).not.toHaveBeenCalled();
    expect(h.onMoved).not.toHaveBeenCalled();
  });

  it('悬停自身/自身子孙:无反馈;松手不写库也不报错(冒泡后无合法落点)', () => {
    h.startDrag('工作');
    h.fire(h.row('工作/项目A'), 'dragover');
    expect(h.over()).toBe('');
    h.fire(h.row('工作/项目A'), 'drop');
    expect(moveTag).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('结构节点行不可作目标:冒泡到其父级,悬停与松手都用冒泡后的落点', () => {
    h.startDrag('工作/项目B');
    h.fire(h.row('生活/兜底'), 'dragover');
    expect(h.over()).toBe('生活:child');
    h.fire(h.row('生活/兜底'), 'drop');
    expect(moveTag).toHaveBeenCalledWith(4, 5);
  });

  it('结构节点本身不可拖:dragstart 被拦下,不进拖拽态', () => {
    h.fire(h.row('生活/兜底'), 'dragstart');
    expect(h.meta()).toBe('false||false|false');
  });
});

describe('T7 抖动:100ms dragleave 防抖 + feedback 未变早退', () => {
  it('离开后 100ms 内回到同一目标:反馈不闪;超过 100ms 才清', () => {
    h.startDrag();
    h.fire(h.row('生活'), 'dragover');
    h.fire(h.row('生活'), 'dragleave');
    h.advance(50);
    h.fire(h.row('生活'), 'dragover');
    h.advance(120);
    expect(h.over()).toBe('生活:child');
    h.fire(h.row('生活'), 'dragleave');
    h.advance(120);
    expect(h.over()).toBe('');
  });
});

describe('T2 悬停 500ms 自动展开', () => {
  it('折叠且有子级的行:500ms 到才展开,同一节点不重计时', () => {
    h.startDrag('生活');
    h.fire(h.row('工作'), 'dragover');
    h.advance(300);
    h.fire(h.row('工作'), 'dragover');
    expect(h.onAutoExpand).not.toHaveBeenCalled();
    h.advance(210);
    expect(h.onAutoExpand).toHaveBeenCalledTimes(1);
    expect(h.onAutoExpand).toHaveBeenCalledWith('工作');
  });
});
