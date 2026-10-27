/**
 * 合并自同目录下的小用例文件(架构精简 C,2026-10-27):
 *   - caret-screen.test.ts
 *   - caret-scroll.test.ts
 *   - edit-flush.test.ts
 *   - edit-tag-count.test.ts
 *   - tag-display.test.ts
 * 每个原文件的顶层 `describe` 原样保留,用例数前后必须逐个相等。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_COUNT_HINT_MAX, tagCountHint, tagCountLabel } from './edit-tag-count';
import { caretScrollDelta } from './caret-screen';
import { caretScrollTop } from './caret-scroll';
import { flushEditing, hasEditingPanel, registerEditFlush } from './edit-flush';
import { tagDisplayName } from './tag-display';

describe('editor 合并用例', () => {
  describe('caretScrollDelta(把光标拉回点击的屏幕位置)', () => {
    it('光标落在点击位置下方:往下滚(正数)', () => {
      // 框顶在视口 100,光标在框内 400,框滚动 0 -> 光标屏幕 y = 500;点击在 300 -> 要往下滚 200
      expect(caretScrollDelta({ boxTop: 100, caretInBox: 400, boxScroll: 0, clickY: 300 })).toBe(200);
    });
    it('光标落在点击位置上方:往上滚(负数)', () => {
      expect(caretScrollDelta({ boxTop: 100, caretInBox: 100, boxScroll: 0, clickY: 300 })).toBe(-100);
    });
    it('已经对齐:0', () => {
      expect(caretScrollDelta({ boxTop: 50, caretInBox: 250, boxScroll: 0, clickY: 300 })).toBe(0);
    });
    it('框自身滚动会抵扣', () => {
      expect(caretScrollDelta({ boxTop: 0, caretInBox: 500, boxScroll: 300, clickY: 100 })).toBe(100);
    });
    it('拿不到数值:0(不动作)', () => {
      expect(caretScrollDelta({ boxTop: Number.NaN, caretInBox: 1, boxScroll: 0, clickY: 1 })).toBe(0);
    });
  });

  describe('一步修正的收敛性(按当前滚动)', () => {
    it('重复应用不再来回跳:第二次的差值为 0', () => {
      // 框在内容里的位置固定为 800(视口位置 = 800 − scroll),光标在框内 200,点击在 300
      const boxInContent = 800;
      const caretInBox = 200;
      const clickY = 300;
      const step = (scroll: number) => {
        const boxTop = boxInContent - scroll;
        return scroll + caretScrollDelta({ boxTop, caretInBox, boxScroll: 0, clickY });
      };
      const s1 = step(562);
      const s2 = step(s1);
      expect(s1).toBe(562 + (800 - 562 + 200 - 300)); // 一步到位
      expect(s2).toBe(s1);                            // 再算一次不动 -> 收敛
    });
  });

  const base = { lineHeight: 24, clientHeight: 600, scrollHeight: 4000 };

  describe('caretScrollTop(把光标行滚到框内 1/3 处)', () => {
    it('光标在中段:目标 = 行位置 − 1/3 视高', () => {
      // 第 40 行 -> y = 960;960 − 200 = 760
      expect(caretScrollTop({ ...base, caret: 500, newlinesBefore: 40 })).toBe(760);
    });

    it('光标在开头:夹到 0(不出现负滚动)', () => {
      expect(caretScrollTop({ ...base, caret: 0, newlinesBefore: 0 })).toBe(0);
    });

    it('光标在末尾:不超过 scrollHeight − clientHeight', () => {
      const v = caretScrollTop({ ...base, caret: 5000, newlinesBefore: 200 });
      expect(v).toBe(4000 - 600);
    });

    it('长行折行(字符数远多于换行数):按换行数估算,不夸张地多滚', () => {
      // 换行 5 行、光标前 800 字符(同一行的折行)-> 按 5 行估算:120 − 200 < 0 -> 夹到 0
      expect(caretScrollTop({ ...base, caret: 800, newlinesBefore: 5 })).toBe(0);
      // 换行 20 行时:480 − 200 = 280
      expect(caretScrollTop({ ...base, caret: 800, newlinesBefore: 20 })).toBe(280);
    });

    it('行高拿不到(0/NaN):返回 0,不抛', () => {
      expect(caretScrollTop({ ...base, lineHeight: 0, caret: 10, newlinesBefore: 2 })).toBe(0);
      expect(caretScrollTop({ ...base, lineHeight: Number.NaN, caret: 10, newlinesBefore: 2 })).toBe(0);
    });
  });

  /** 编辑态 flush 通道的单测:没面板放行、成功放行、失败带中文原因不静默 */

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

  describe('tagCountLabel', () => {
    it('中文文案「标签 N 个」', () => {
      expect(tagCountLabel(0)).toBe('标签 0 个');
      expect(tagCountLabel(3)).toBe('标签 3 个');
    });
  });

  describe('tagCountHint', () => {
    it('阈值为 5:5 个及以下不提示', () => {
      expect(TAG_COUNT_HINT_MAX).toBe(5);
      expect(tagCountHint(0)).toBeNull();
      expect(tagCountHint(5)).toBeNull();
    });
    it('超过 5 个提示「建议 3-5 个」', () => {
      expect(tagCountHint(6)).toBe('建议 3-5 个');
      expect(tagCountHint(11)).toBe('建议 3-5 个');
    });
  });

  describe('tagDisplayName(S4:一律完整路径)', () => {
    it('根级标签原样', () => {
      expect(tagDisplayName('工作')).toBe('工作');
      expect(tagDisplayName('todo')).toBe('todo');
    });

    it('多级路径原样返回,不退化成末级', () => {
      expect(tagDisplayName('工作/项目A/会议')).toBe('工作/项目A/会议');
      expect(tagDisplayName('工作/项目A')).toBe('工作/项目A');
      expect(tagDisplayName('时间排序/2026/09/17')).toBe('时间排序/2026/09/17');
    });

    it('不同父级下的同名末级可区分', () => {
      expect(tagDisplayName('工作/会议')).not.toBe(tagDisplayName('生活/会议'));
    });

    it('空路径原样', () => {
      expect(tagDisplayName('')).toBe('');
    });
  });

});
