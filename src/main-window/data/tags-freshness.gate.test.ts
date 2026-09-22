/**
 * 标签新鲜度门禁(T6 修复轮 I2):静态扫描全仓,断言「会写笔记的命令」只在唯一出口里被调用。
 *
 * 为什么要有这条门禁:浮层 `#` 候选与侧栏标签树同源,靠"改标签的人都记得递增 tagsVersion"必然漏
 * (复审实测两条绕过:卸载兜底静默保存、输入栏保存在已翻页/编辑态时不刷新)。所以把"标签可能变了"
 * 收敛成一个出口,并用本用例保证**没有旁路**:新增写库路径若直接调 api.updateNote/api.deleteNote,
 * 这里立刻红。
 *
 * 允许清单(每条的到达出口方式都写在 why 里):
 * - note-writes.ts:出口本体,成功后 notifyTagsChanged();
 * - 跨窗的 save_input_note:主窗由 use-note-created.ts 订阅 note-created 后通知出口
 *   (行为用例见 use-note-created.test.ts)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** 源码文件(排除测试:测试里出现写命令是正常的,它就是在测调用方) */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

interface WriteCall {
  call: string;
  allowed: string[];
  why: string;
}

const WRITE_CALLS: readonly WriteCall[] = [
  {
    call: 'api.updateNote(',
    allowed: ['main-window/data/note-writes.ts'],
    why: '唯一写出口,成功后 notifyTagsChanged',
  },
  {
    call: 'api.deleteNote(',
    allowed: ['main-window/data/note-writes.ts'],
    why: '同上(删除会改标签计数与孤儿标签)',
  },
  {
    call: 'api.saveInputNote(',
    allowed: ['input-bar/InputBar.tsx', 'main-window/stream/Composer.tsx'],
    why: '跨窗写入:Rust 落库后 emit note-created,主窗 use-note-created 订阅后通知出口',
  },
];

const FILES = sourceFiles(SRC);

describe('标签新鲜度门禁:写笔记的命令只在唯一出口', () => {
  for (const { call, allowed, why } of WRITE_CALLS) {
    it(`${call} 只允许出现在 ${allowed.join(' / ')},理由:${why}`, () => {
      const hits = FILES.filter((f) => readFileSync(f, 'utf8').includes(call))
        .map((f) => relative(SRC, f).replace(/\\/g, '/'))
        .sort();
      expect(hits).toEqual([...allowed].sort());
    });
  }

  it('出口本体确实调了通知(扫不到就是出口被改坏了)', () => {
    const exit = readFileSync(join(SRC, 'main-window/data/note-writes.ts'), 'utf8');
    expect(exit).toContain('notifyTagsChanged()');
  });

  it('跨窗订阅方无条件通知出口(不受 shouldAutoRefresh 影响)', () => {
    const sub = readFileSync(join(SRC, 'main-window/data/use-note-created.ts'), 'utf8');
    expect(sub).toContain('notifyTagsChanged()');
  });

  it('主窗订阅了出口(否则出口通知没人听,`#` 照样陈旧)', () => {
    const app = readFileSync(join(SRC, 'main-window/App.tsx'), 'utf8');
    expect(app).toContain('onTagsChanged(loadTags)');
  });
});
