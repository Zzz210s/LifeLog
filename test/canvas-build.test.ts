import { describe, expect, it } from 'vitest';
import { buildCanvas, existingPositions, stableId } from '../src/canvas/build';

const ents = [
  { path: '地点', parentPath: null },
  { path: '地点/印度', parentPath: '地点' },
  { path: '地点/日本', parentPath: '地点' },
  { path: '状态', parentPath: null },
];

describe('stableId', () => {
  it('同一路径 id 恒定，不同路径不同', () => {
    expect(stableId('n', '地点/印度')).toBe(stableId('n', '地点/印度'));
    expect(stableId('n', '地点/印度')).not.toBe(stableId('n', '地点/日本'));
  });
});

describe('buildCanvas', () => {
  const doc = buildCanvas(ents, [{ from: '地点/日本', to: '地点/印度', name: '国籍' }]);

  it('每个实体一张文件卡，路径带 实体/ 前缀', () => {
    expect(doc.nodes).toHaveLength(4);
    expect(doc.nodes.map((n) => n.file)).toContain('拾枝/实体/地点/印度.md');
  });

  it('按深度分列：根在 x=0，子级在 x=320', () => {
    const root = doc.nodes.find((n) => n.file.endsWith('地点.md'))!;
    const child = doc.nodes.find((n) => n.file.endsWith('印度.md'))!;
    expect(root.x).toBe(0);
    expect(child.x).toBe(320);
  });

  it('树边按父→子生成', () => {
    const treeEdges = doc.edges.filter((e) => !e.label);
    expect(treeEdges).toHaveLength(2);
  });

  it('关系边带 label（原生图给不了的）', () => {
    const rel = doc.edges.find((e) => e.label === '国籍')!;
    expect(rel).toBeTruthy();
    expect(rel.fromNode).toBe(stableId('n', '地点/日本'));
  });

  it('保留用户已拖坐标', () => {
    const id = stableId('n', '地点/印度');
    const keep = existingPositions({ nodes: [{ id, type: 'file', file: 'x', x: 777, y: 888, width: 1, height: 1 }], edges: [] });
    const again = buildCanvas(ents, [], keep);
    const node = again.nodes.find((n) => n.id === id)!;
    expect([node.x, node.y]).toEqual([777, 888]);
  });

  it('其它节点不受旧坐标影响', () => {
    const id = stableId('n', '地点/印度');
    const keep = existingPositions({ nodes: [{ id, type: 'file', file: 'x', x: 777, y: 888, width: 1, height: 1 }], edges: [] });
    const again = buildCanvas(ents, [], keep);
    expect(again.nodes.find((n) => n.file.endsWith('日本.md'))!.x).toBe(320);
  });
});
