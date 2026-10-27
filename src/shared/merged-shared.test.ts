/**
 * 合并自同目录下的小用例文件(架构精简 C,2026-10-27):
 *   - fuzzy-score-prefix.test.ts
 *   - input-feedback.test.ts
 *   - input-lock.test.ts
 *   - input-prefix.test.ts
 *   - startup-action.test.ts
 *   - startup-settings.test.ts
 * 每个原文件的顶层 `describe` 原样保留,用例数前后必须逐个相等。
 */
import { describe, expect, it } from 'vitest';
import { LABEL_PREFIX_BOOST, scoreFuzzy } from './fuzzy-score';
import { NOTE_PREFIX, PREFIXES, parseInput, withPrefix } from './input-prefix';
import { canClose, canDrag, canEdit, emptyLock, lockStateFrom } from './input-lock';
import { parseStartupSettings, resolveAutostartStatus } from './startup-settings';
import { readFileSync } from 'node:fs';
import { resolveStartupAction } from './startup-action';
import { savedStamp, shouldShowStamp } from './input-feedback';

describe('shared 合并用例', () => {
  /**
   * 前缀命中的**位置策略**真测试(T2 审查 I1 遗留)。
   *
   * 策略(实现 `fuzzy-score.ts:171`,上游 `fuzzyScorer.ts:531` 同源):查询是目标串真前缀时,
   * 高亮取**整段前缀** `[0..q-1]`,而 DP 回溯出来的位置只用于算分 —— 二者**不等价**,
   * 分隔符加分可能让 DP 走另一条路径。这里用一条特征化用例把两种取值同时钉住,
   * 防止有人"顺手改成 raw.positions"却全绿放行(变异 M9)。
   */

  const TARGET = '作aA工.a作/AB作B'; // 12 字符,下标 8 的 'A' 前面是 '/'(分隔符 +5)
  const QUERY = '作A';

  describe('前缀命中:高亮取整段前缀', () => {
    it('查询是真前缀时 positions 为 [0..q-1](不依赖 DP 结果)', () => {
      const result = scoreFuzzy(QUERY, TARGET);
      expect(result.positions).toEqual([0, 1]);
      // 默认分 = 前缀档基数 + 前缀长度加权 round(2/12*100) + 原始分 17
      expect(result.score).toBe(LABEL_PREFIX_BOOST + Math.round((2 / TARGET.length) * 100) + 17);
    });

    it('大小写错位的前缀同样整段高亮', () => {
      expect(scoreFuzzy('Ab', 'aBc').positions).toEqual([0, 1]);
      expect(scoreFuzzy('项A', '项A/子项').positions).toEqual([0, 1]);
    });

    it('特征化:DP 最优路径是 [0,8],高亮仍是 [0,1](与上游同源,刻意保留)', () => {
      // t[8]='A' 前有 '/'(+5 分隔符)且大小写相同(+1),DP 路径得分 10+7=17;
      // 而前缀区间 [0,1] 的 'a' 大小写不同、前面无分隔符,那条路径只值 10+1=11。
      // 于是分数来自 DP 最优路径、高亮来自前缀区间,二者指向不同下标 —— 上游固有行为,非缺陷。
      expect(scoreFuzzy(QUERY, TARGET, { boostTiers: false })).toEqual({ score: 17, positions: [0, 8] });
      expect(scoreFuzzy(QUERY, TARGET).positions).toEqual([0, 1]);
      // 两串位置都能大小写不敏感地拼回查询;高亮取 [0,1] 更贴近真实前缀(大小写错位但连成一段)
      const norm = (text: string): string => text.toLowerCase();
      expect(norm([0, 1].map((i) => TARGET[i]).join(''))).toBe(norm(QUERY));
      expect(norm([0, 8].map((i) => TARGET[i]).join(''))).toBe(norm(QUERY));
    });
  });

  describe('savedStamp', () => {
    it('格式为 已保存 HH:MM,分钟补零', () => {
      expect(savedStamp(new Date(2026, 8, 11, 9, 5))).toBe('已保存 09:05');
    });
    it('小时补零', () => {
      expect(savedStamp(new Date(2026, 8, 11, 23, 59))).toBe('已保存 23:59');
    });
  });

  describe('shouldShowStamp', () => {
    it('1.5 秒内显示', () => {
      expect(shouldShowStamp(1000, 2000)).toBe(true);
    });
    it('超过 1.5 秒不显示', () => {
      expect(shouldShowStamp(1000, 2600)).toBe(false);
    });
    it('未保存过(0)不显示', () => {
      expect(shouldShowStamp(0, 100)).toBe(false);
    });
  });

  describe('lockStateFrom', () => {
    it('默认全解锁', () => {
      const l = lockStateFrom({ lockMove: false, lockClose: false, lockContent: false });
      expect(canDrag(l)).toBe(true);
      expect(canClose(l)).toBe(true);
      expect(canEdit(l)).toBe(true);
    });
    it('各档独立', () => {
      const l = lockStateFrom({ lockMove: true, lockClose: false, lockContent: false });
      expect(canDrag(l)).toBe(false);
      expect(canClose(l)).toBe(true);
      expect(canEdit(l)).toBe(true);
    });
    it('仅阻止关闭时另两档仍可拖动、可编辑', () => {
      const l = lockStateFrom({ lockMove: false, lockClose: true, lockContent: false });
      expect(canClose(l)).toBe(false);
      expect(canDrag(l)).toBe(true);
      expect(canEdit(l)).toBe(true);
    });
    it('仅锁定内容时另两档仍可拖动、可关闭', () => {
      const l = lockStateFrom({ lockMove: false, lockClose: false, lockContent: true });
      expect(canEdit(l)).toBe(false);
      expect(canDrag(l)).toBe(true);
      expect(canClose(l)).toBe(true);
    });
  });

  describe('emptyLock', () => {
    it('全解锁', () => {
      expect(emptyLock()).toEqual({ move: false, close: false, content: false });
    });
  });

  const fx = JSON.parse(readFileSync(new URL('../../fixtures/input-prefix.json', import.meta.url), 'utf-8')) as {
    cases: { raw: string; mode: string; query: string }[];
  };

  describe('parseInput(向量驱动,Rust 侧不涉)', () => {
    for (const c of fx.cases) {
      it(`raw=${JSON.stringify(c.raw)} -> ${c.mode}`, () => {
        const got = parseInput(c.raw);
        expect(got.mode).toBe(c.mode);
        expect(got.query).toBe(c.query);
      });
    }
  });

  describe('PREFIXES 表', () => {
    it('四个前缀各一条,顺序固定,提示文案非空', () => {
      expect(PREFIXES.map((p) => p.prefix)).toEqual(['>', '/', '#', '@']);
      for (const p of PREFIXES) expect(p.hint.length).toBeGreaterThan(0);
    });
    it('无前缀那条单独导出,且 mode=note', () => {
      expect(NOTE_PREFIX.prefix).toBe('');
      expect(NOTE_PREFIX.mode).toBe('note');
    });
  });

  describe('withPrefix:切换前缀保留内容', () => {
    it('/牛奶 -> #牛奶', () => expect(withPrefix('/牛奶', '#')).toBe('#牛奶'));
    it('牛奶 -> @牛奶', () => expect(withPrefix('牛奶', '@')).toBe('@牛奶'));
    it('@ -> <> (切到命令)', () => expect(withPrefix('@', '>')).toBe('>'));
    it('空 -> /', () => expect(withPrefix('', '/')).toBe('/'));
  });

  describe('resolveStartupAction', () => {
    it('默认启动显示输入栏', () => {
      expect(resolveStartupAction({ autostart: false, startupShow: 'input-bar' }, false)).toBe('show-input');
    });
    it('设置为仅托盘时静默进托盘', () => {
      expect(resolveStartupAction({ autostart: false, startupShow: 'tray-only' }, false)).toBe('tray-only');
      expect(resolveStartupAction({ autostart: true, startupShow: 'tray-only' }, true)).toBe('tray-only');
    });
    // spec 3.1:手动启动与开机自启一致,默认都唤起输入栏 —— 拉起方式不改变动作
    it('拉起方式不改变动作', () => {
      expect(resolveStartupAction({ autostart: true, startupShow: 'input-bar' }, true)).toBe('show-input');
      expect(resolveStartupAction({ autostart: false, startupShow: 'input-bar' }, true)).toBe('show-input');
    });
  });

  /** 注册表真实状态的简写:enabled/pathOk */
  const actual = (enabled: boolean, pathOk: boolean) => ({ enabled, pathOk });

  describe('parseStartupSettings', () => {
    it('缺省为关闭自启、启动显示输入栏', () => {
      expect(parseStartupSettings({})).toEqual({ autostart: false, startupShow: 'input-bar' });
    });
    it('非法值回退默认', () => {
      expect(parseStartupSettings({ input_startup_show: 'nonsense' }).startupShow).toBe('input-bar');
      expect(parseStartupSettings({ input_autostart: '' }).autostart).toBe(false);
    });
    it('合法值生效', () => {
      expect(parseStartupSettings({ input_autostart: 'true', input_startup_show: 'tray-only' }))
        .toEqual({ autostart: true, startupShow: 'tray-only' });
    });
  });

  describe('resolveAutostartStatus', () => {
    it('期望与实际一致即为稳定态', () => {
      expect(resolveAutostartStatus(false, actual(false, false))).toBe('off');
      expect(resolveAutostartStatus(true, actual(true, true))).toBe('on');
    });
    it('期望开但系统没有(或反之)需要修复', () => {
      expect(resolveAutostartStatus(true, actual(false, false))).toBe('needs-repair');
      expect(resolveAutostartStatus(false, actual(true, true))).toBe('needs-repair');
    });
    it('注册表里残留旧安装路径也要提示修复', () => {
      // is_enabled() 仍为 true 的典型场景:值存在但指向 dev/旧位置
      expect(resolveAutostartStatus(true, actual(true, false))).toBe('needs-repair');
      // 期望关闭时路径已无意义:值删掉就是目标态
      expect(resolveAutostartStatus(false, actual(false, false))).toBe('off');
    });
  });

});
