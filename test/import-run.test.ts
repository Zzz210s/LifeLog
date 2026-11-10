import { describe, expect, it } from 'vitest';
import { VaultWriter, freePath, importFiles, summaryText } from '../src/import/run';
import { FileOut } from '../src/import/map';

function memWriter(initial: string[] = []): VaultWriter & { files: Map<string, string>; dirs: string[] } {
  const files = new Map<string, string>(initial.map((p) => [p, 'old']));
  const dirs: string[] = [];
  return {
    files,
    dirs,
    exists: (p) => files.has(p),
    ensureFolder: async (d) => {
      dirs.push(d);
    },
    create: async (p, c) => {
      files.set(p, c);
    },
  };
}

const f = (path: string, content = 'x'): FileOut => ({ path, content });

describe('freePath', () => {
  it('未占用时原样返回', () => {
    expect(freePath('a/b.md', () => false)).toBe('a/b.md');
  });

  it('占用时依次加后缀，保留 .md', () => {
    const taken = new Set(['a/b.md', 'a/b-2.md']);
    expect(freePath('a/b.md', (p) => taken.has(p))).toBe('a/b-3.md');
  });

  it('后缀耗尽返回 null（交给调用方记 skipped）', () => {
    expect(freePath('a/b.md', () => true, 3)).toBeNull();
  });
});

describe('importFiles', () => {
  it('不覆盖已有文件，改为追加后缀', async () => {
    const w = memWriter(['拾枝/笔记/2026/10/9-标题.md']);
    const r = await importFiles([f('拾枝/笔记/2026/10/9-标题.md', 'new')], w);
    expect(r).toEqual({ created: 1, renamed: 1, skipped: 0, dirs: 1 });
    expect(w.files.get('拾枝/笔记/2026/10/9-标题.md')).toBe('old');
    expect(w.files.get('拾枝/笔记/2026/10/9-标题-2.md')).toBe('new');
  });

  it('同目录只建一次，目录数按去重计', async () => {
    const w = memWriter();
    const r = await importFiles(
      [f('拾枝/笔记/2026/10/a.md'), f('拾枝/笔记/2026/10/b.md'), f('拾枝/实体/x.md')],
      w,
    );
    expect(r.dirs).toBe(2);
    expect(w.dirs).toEqual(['拾枝/笔记/2026/10', '拾枝/实体']);
  });

  it('进度回调最后一次一定是满额', async () => {
    const calls: [number, number][] = [];
    await importFiles([f('a/1.md'), f('a/2.md')], memWriter(), (d, t) => calls.push([d, t]));
    expect(calls.at(-1)).toEqual([2, 2]);
  });

  it('汇总文案只在有值时报改名/跳过', () => {
    expect(summaryText({ created: 3, renamed: 0, skipped: 0, dirs: 1 })).toBe('新建 3 个文件，目录 1 个');
    expect(summaryText({ created: 3, renamed: 1, skipped: 2, dirs: 1 })).toContain('跳过 2 个');
  });
});
