/**
 * 落点解析(T3/T4/T7)纯函数证据:
 * - 整行 = 成为子级;边界带两半 = 上一行之后 / 下一行之前(同父级归一化)
 * - 无效目标(自身/子孙/结构节点)向父级冒泡,一路找不到 -> null(不反馈)
 * - 同父级同位、成为当前父级子级 = 原地不动 -> null(不反馈、不写库)
 */
import { describe, expect, it } from 'vitest';
import type { TagNode } from './tag-tree';
import {
  bandHalves,
  findNode,
  isNoopDrop,
  parentOf,
  parentPrefix,
  resolveDrop,
  sameParent,
  sameTarget,
} from './drag-resolve';

const node = (id: number | null, path: string, children: TagNode[] = []): TagNode => ({
  id,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  depth: path.split('/').length,
  sortOrder: 0,
  selfCount: 1,
  subtreeCount: 1,
  children,
});

/**
 * 工作            (1)
 *   项目A         (2)
 *     会议        (3)
 *   项目B         (4)
 * 生活            (5)
 *   缺父结构节点   (null, 兜底路径才存在)
 */
const tree: TagNode[] = [
  node(1, '工作', [node(2, '工作/项目A', [node(3, '工作/项目A/会议')]), node(4, '工作/项目B')]),
  node(5, '生活', [node(null, '生活/兜底')]),
];

describe('parentOf / sameParent / findNode', () => {
  it('父级路径:根级为空串、子级不带尾斜杠;父级前缀供拼新路径', () => {
    expect(parentOf('工作')).toBe('');
    expect(parentOf('工作/项目A')).toBe('工作');
    expect(parentOf('工作/项目A/会议')).toBe('工作/项目A');
    expect(parentPrefix('工作')).toBe('');
    expect(parentPrefix('工作/项目A')).toBe('工作/');
  });
  it('同级判定按父级前缀', () => {
    expect(sameParent('工作/项目A', '工作/项目B')).toBe(true);
    expect(sameParent('工作/项目A', '工作/项目A/会议')).toBe(false);
    expect(sameParent('工作', '生活')).toBe(true);
  });
  it('findNode 按路径在整棵树里找(含深层)', () => {
    expect(findNode(tree, '工作/项目A/会议')?.id).toBe(3);
    expect(findNode(tree, '生活/兜底')?.id).toBe(null);
    expect(findNode(tree, '不存在')).toBe(null);
  });
});

describe('resolveDrop:整行 = 成为子级', () => {
  it('拖到别的行上 = 成为其子级', () => {
    expect(resolveDrop(tree, { id: 5, path: '工作' }, { path: '生活', zone: 'child' })).toEqual({
      path: '生活',
      zone: 'child',
    });
  });
  it('边界带的两半:插到锚点之前/之后(同级)', () => {
    expect(resolveDrop(tree, { id: 5, path: '生活' }, { path: '工作/项目B', zone: 'before' })).toEqual({
      path: '工作/项目B',
      zone: 'before',
    });
    expect(resolveDrop(tree, { id: 5, path: '生活' }, { path: '工作/项目B', zone: 'after' })).toEqual({
      path: '工作/项目B',
      zone: 'after',
    });
  });
});

describe('resolveDrop:无效目标向父级冒泡(T4)', () => {
  it('拖到自己身上的整行:冒到父级,一路到根仍不合法 -> null(不显示任何反馈)', () => {
    expect(resolveDrop(tree, { id: 1, path: '工作' }, { path: '工作', zone: 'child' })).toBe(null);
  });
  it('拖到自己子孙的行:逐级冒泡,最终仍是"原地不动" -> null', () => {
    // 会议(子孙,非法) -> 工作/项目A(自身,非法) -> 工作 = 自己的当前父级 => child 无变化
    expect(resolveDrop(tree, { id: 2, path: '工作/项目A' }, { path: '工作/项目A/会议', zone: 'child' })).toBe(null);
  });
  it('拖到自己子孙的边界带:冒泡到源自己父级那一层(真实可落点,zone 保持)', () => {
    // 边界带"会议之前"= 在 工作/项目A 这一层插入;冒到 工作 后就是"插到工作之前"(升一层)
    expect(resolveDrop(tree, { id: 2, path: '工作/项目A' }, { path: '工作/项目A/会议', zone: 'before' })).toEqual({
      path: '工作',
      zone: 'before',
    });
  });
  it('结构节点(id null)作目标:冒到其合法祖先', () => {
    expect(resolveDrop(tree, { id: 1, path: '工作' }, { path: '生活/兜底', zone: 'child' })).toEqual({
      path: '生活',
      zone: 'child',
    });
  });
  it('结构节点且祖先链上只有结构节点 -> null', () => {
    const onlyStructural: TagNode[] = [node(null, '缺父')];
    expect(resolveDrop(onlyStructural, { id: 1, path: '工作' }, { path: '缺父', zone: 'child' })).toBe(null);
  });
  it('源本身是结构节点(id null):一律 null', () => {
    expect(resolveDrop(tree, { id: null, path: '生活/兜底' }, { path: '生活', zone: 'child' })).toBe(null);
  });
});

describe('resolveDrop / isNoopDrop:原地不动不留假成功(T4/T8)', () => {
  it('成为当前父级的子级 = 无变化 -> null', () => {
    expect(isNoopDrop(tree, { id: 2, path: '工作/项目A' }, { path: '工作', zone: 'child' })).toBe(true);
    expect(resolveDrop(tree, { id: 2, path: '工作/项目A' }, { path: '工作', zone: 'child' })).toBe(null);
  });
  it('插到自己紧邻的位置 = 无变化 -> null', () => {
    // 工作/项目B 已在 工作/项目A 之后:插到 项目A 之后等价于原地不动
    expect(isNoopDrop(tree, { id: 4, path: '工作/项目B' }, { path: '工作/项目A', zone: 'after' })).toBe(true);
    // 工作/项目A 已在 工作/项目B 之前:插到 项目B 之前同样等价
    expect(isNoopDrop(tree, { id: 2, path: '工作/项目A' }, { path: '工作/项目B', zone: 'before' })).toBe(true);
    expect(resolveDrop(tree, { id: 4, path: '工作/项目B' }, { path: '工作/项目A', zone: 'after' })).toBe(null);
  });
  it('跨父级的同级插入不是无变化(真实移动)', () => {
    expect(isNoopDrop(tree, { id: 4, path: '工作/项目B' }, { path: '生活', zone: 'after' })).toBe(false);
    expect(resolveDrop(tree, { id: 4, path: '工作/项目B' }, { path: '生活', zone: 'after' })).toEqual({
      path: '生活',
      zone: 'after',
    });
  });
  it('非紧邻的兄弟插入是真实移动', () => {
    // 工作已是 生活 之前,再"插到生活之前"才是无变化;"插到生活之后"是真的换位
    expect(isNoopDrop(tree, { id: 1, path: '工作' }, { path: '生活', zone: 'before' })).toBe(true);
    expect(isNoopDrop(tree, { id: 1, path: '工作' }, { path: '生活', zone: 'after' })).toBe(false);
  });
});

describe('bandHalves:边界带对半与同父级归一化(T3/T7)', () => {
  it('同一父级的上下两行:上半归一化成"下一行之前"(两个选择等价,免抖动)', () => {
    expect(bandHalves({ path: '工作/项目A' }, { path: '工作/项目B' })).toEqual({
      upper: { path: '工作/项目B', zone: 'before' },
      lower: { path: '工作/项目B', zone: 'before' },
    });
  });
  it('跨层级时两半各按自己的层级:上半 = 上一行之后,下半 = 下一行之前', () => {
    expect(bandHalves({ path: '工作' }, { path: '工作/项目A' })).toEqual({
      upper: { path: '工作', zone: 'after' },
      lower: { path: '工作/项目A', zone: 'before' },
    });
  });
  it('首行没有上半、末行(末尾带)没有下半', () => {
    expect(bandHalves(null, { path: '工作' })).toEqual({
      upper: null,
      lower: { path: '工作', zone: 'before' },
    });
    expect(bandHalves({ path: '工作' }, null)).toEqual({
      upper: { path: '工作', zone: 'after' },
      lower: null,
    });
  });
});

describe('sameTarget:feedback 未变早退的比较口径', () => {
  it('路径与分区都相同才算相同', () => {
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget({ path: '工作', zone: 'child' }, { path: '工作', zone: 'child' })).toBe(true);
    expect(sameTarget({ path: '工作', zone: 'child' }, { path: '工作', zone: 'before' })).toBe(false);
    expect(sameTarget({ path: '工作', zone: 'child' }, null)).toBe(false);
  });
});
