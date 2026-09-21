import { describe, expect, it } from 'vitest';
import { canDrag, checkDrop } from './drag-check';

const node = (id: number | null, path: string): { id: number | null; path: string } => ({ id, path });

describe('canDrag', () => {
  it('真实标签行(id 非 null)可拖', () => {
    expect(canDrag(node(3, '工作'))).toBe(true);
  });
  it('补出的结构节点(id null)不可拖', () => {
    expect(canDrag(node(null, '工作'))).toBe(false);
  });
  it('时间标签已是普通标签(D3):有真实 DB id 就同样可拖', () => {
    expect(canDrag(node(2, '时间排序'))).toBe(true);
    expect(canDrag(node(3, '时间排序/2026'))).toBe(true);
    expect(canDrag(node(4, '时间排序/2026/09/13'))).toBe(true);
  });
  it('前缀相近的兄弟标签(时间排序器)同样可拖', () => {
    expect(canDrag(node(9, '时间排序器'))).toBe(true);
  });
});

describe('checkDrop', () => {
  it('拖到其他真实标签上:放行(整行 = 成为其子级)', () => {
    expect(checkDrop(node(5, '工作/项目B'), node(6, '生活'))).toEqual({ ok: true });
  });
  it('拖到分区空白(target null = 移到根级):放行', () => {
    expect(checkDrop(node(5, '生活/项目B'), null)).toEqual({ ok: true });
  });
  it('拖到当前父级上:放行(无变化由 drag-resolve 判掉,这里只判结构上允许)', () => {
    expect(checkDrop(node(5, '生活/项目B'), node(6, '生活'))).toEqual({ ok: true });
  });
  it('不能拖到自身', () => {
    const v = checkDrop(node(2, '工作'), node(2, '工作'));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('自身');
  });
  it('不能拖到自身子树(路径前缀判断,多级子孙都拒)', () => {
    expect(checkDrop(node(2, '工作'), node(3, '工作/项目A')).ok).toBe(false);
    expect(checkDrop(node(2, '工作'), node(4, '工作/项目A/会议')).ok).toBe(false);
  });
  it('前缀判断不误伤同前缀的兄弟标签', () => {
    // 「工作」与「工作日志」是兄弟,不是子树
    expect(checkDrop(node(2, '工作'), node(9, '工作日志')).ok).toBe(true);
  });
  it('源是结构节点(id null):一律拒绝', () => {
    const v = checkDrop(node(null, '工作'), node(6, '生活'));
    expect(v).toEqual({ ok: false, reason: '结构节点不可拖动' });
  });
  it('目标是结构节点(id null):拒绝(不可作为移动目标)', () => {
    const v = checkDrop(node(7, '生活/健身'), node(null, '工作'));
    expect(v).toEqual({ ok: false, reason: '结构节点不可作为移动目标' });
  });
  it('源是结构节点时拖到根级(target null)同样拒绝', () => {
    expect(checkDrop(node(null, '工作'), null)).toEqual({ ok: false, reason: '结构节点不可拖动' });
  });
  it('时间标签不再是特例:拖到时间子树下与从时间子树拖出都放行', () => {
    expect(checkDrop(node(5, '工作'), node(4, '时间排序/2026'))).toEqual({ ok: true });
    expect(checkDrop(node(5, '工作'), node(2, '时间排序'))).toEqual({ ok: true });
    expect(checkDrop(node(3, '时间排序/2026'), node(5, '工作'))).toEqual({ ok: true });
    expect(checkDrop(node(3, '时间排序/2026'), null)).toEqual({ ok: true });
  });
});
