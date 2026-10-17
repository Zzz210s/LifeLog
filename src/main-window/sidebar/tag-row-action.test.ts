/**
 * 行单击意图判定的纯函数用例(设计 2026-10-16 §3/§4,计划 T1):
 * 真值表主表 8 行(可选行 × 2 模式 × 4 修饰键状态)+ 容器行 2 组(有子级的容器 / 无子级的空实体)
 * + 修饰键冲突优先级(Ctrl > Alt > Shift)+ `modsOf` 的 ⌘ 归一。
 * 只管"发什么意图",不管谁执行;执行在 `use-tag-click`(T4)。
 * 2026-10-16 用户要求「点击行为只保留筛选和打开」:主表由 12 行减为 8 行,`select` 意图已删。
 * 2026-10-17 用户要求「打开档单击 = 只看这一条(不再是预览)」:`open` 档的无修饰键单击由 `open`
 * 改为 `only`,预览卡片退到双击(`dblIntent`);修饰键四格与容器行口径一格未动。
 */
import { describe, expect, it } from 'vitest';
import { dblIntent, modifierIntent, modsOf, rowIntent } from './tag-row-action';
import type { ClickMods, RowIntent } from './tag-row-action';
import type { SidebarClickMode } from './use-sidebar-state';

/** 四个修饰键状态(真值表列头);键名用于 `it.each` 的用例名 */
type ModKey = '无' | 'Ctrl' | 'Alt' | 'Shift';

const mods = (key: ModKey): ClickMods => ({
  ctrl: key === 'Ctrl',
  alt: key === 'Alt',
  shift: key === 'Shift',
});

const MOD_KEYS: readonly ModKey[] = ['无', 'Ctrl', 'Alt', 'Shift'];

const MODES: readonly SidebarClickMode[] = ['filter', 'open'];

/** 真值表主表(设计 §4.1):可选行 × 2 模式 × 4 修饰键状态 = 8 行 */
const MAIN_TABLE: ReadonlyArray<{
  id: string;
  mode: SidebarClickMode;
  key: ModKey;
  want: RowIntent;
}> = [
  { id: '#1', mode: 'filter', key: '无', want: 'toggle' },
  { id: '#2', mode: 'filter', key: 'Ctrl', want: 'andAdd' },
  { id: '#3', mode: 'filter', key: 'Alt', want: 'exclude' },
  { id: '#4', mode: 'filter', key: 'Shift', want: 'only' },
  { id: '#5', mode: 'open', key: '无', want: 'only' },
  { id: '#6', mode: 'open', key: 'Ctrl', want: 'andAdd' },
  { id: '#7', mode: 'open', key: 'Alt', want: 'exclude' },
  { id: '#8', mode: 'open', key: 'Shift', want: 'only' },
];

describe('真值表主表 8 行(设计 §4.1,两档)', () => {
  it.each(MAIN_TABLE)('主表 $id:$mode 模式 + $key -> $want', ({ mode, key, want }) => {
    expect(rowIntent(mode, mods(key), true)).toBe(want);
  });
});

describe('模式只在无修饰键时参与决策', () => {
  it('无修饰键:filter = toggle,open = only(单击只看这一条,预览在双击)', () => {
    expect(rowIntent('filter', mods('无'), true)).toBe('toggle');
    expect(rowIntent('open', mods('无'), true)).toBe('only');
  });

  it('两档的无修饰键单击都不再是 open:open 意图只由双击给出', () => {
    for (const mode of MODES) expect(rowIntent(mode, mods('无'), true)).not.toBe('open');
  });

  it('修饰键优先于模式:open 模式下 Ctrl 仍是 andAdd', () => {
    expect(rowIntent('open', mods('Ctrl'), true)).toBe('andAdd');
    expect(rowIntent('open', mods('Shift'), true)).toBe('only');
    expect(rowIntent('open', mods('Alt'), true)).toBe('exclude');
  });
});

describe('修饰键冲突优先级 Ctrl > Alt > Shift(P5)', () => {
  it('多修饰键同时按下只出一个动作', () => {
    expect(modifierIntent({ ctrl: true, alt: true, shift: true })).toBe('andAdd');
    expect(modifierIntent({ ctrl: true, alt: true, shift: false })).toBe('andAdd');
    expect(modifierIntent({ ctrl: true, alt: false, shift: true })).toBe('andAdd');
    expect(modifierIntent({ ctrl: false, alt: true, shift: true })).toBe('exclude');
    expect(modifierIntent({ ctrl: false, alt: false, shift: true })).toBe('only');
    expect(modifierIntent({ ctrl: false, alt: false, shift: false })).toBeNull();
  });

  it('两种模式 × 三修饰键同按都是 andAdd(与模式无关)', () => {
    for (const mode of MODES) {
      expect(rowIntent(mode, { ctrl: true, alt: true, shift: true }, true)).toBe('andAdd');
    }
  });
});

describe('双击意图 dblIntent(2026-10-17:单击看,双击预览)', () => {
  /** [模式, 是否可选行, 期望意图] —— 2 × 2 = 4 格 */
  const DBL_TABLE: ReadonlyArray<[SidebarClickMode, boolean, RowIntent]> = [
    ['open', true, 'open'],
    ['open', false, 'expand'],
    ['filter', true, 'expand'],
    ['filter', false, 'expand'],
  ];

  it.each(DBL_TABLE)('dblIntent(%s, 可选=%s) -> %s', (mode, selectable, want) => {
    expect(dblIntent(mode, selectable)).toBe(want);
  });

  it('卡片入口只有一个:open 档双击可选行 = open,其余三格一律 expand(不写条件)', () => {
    expect(dblIntent('open', true)).toBe('open');
    expect([dblIntent('open', false), dblIntent('filter', true), dblIntent('filter', false)]).toEqual([
      'expand',
      'expand',
      'expand',
    ]);
  });

  it('双击不读修饰键:签名只吃「模式 + 是否可选」两参数', () => {
    expect(dblIntent.length).toBe(2);
  });
});

describe('容器行 2 组(设计 §4.2:两模式 × 四修饰键同一结果)', () => {
  it('容器行①有子级的容器(subtreeCount 0):8 格全 expand,不写条件', () => {
    for (const mode of MODES) {
      for (const key of MOD_KEYS) {
        expect(rowIntent(mode, mods(key), false)).toBe('expand');
      }
    }
  });

  it('容器行②无子级的空实体:8 格全 expand(调用侧据此无动作 + flash)', () => {
    // 与①同值:有子级与否由调用侧(hasChildren)判,意图层只说"切换展开态"
    for (const mode of MODES) {
      for (const key of MOD_KEYS) {
        expect(rowIntent(mode, mods(key), false)).toBe('expand');
      }
    }
  });
});

describe('modsOf:键盘 / 鼠标事件到修饰键状态', () => {
  it('metaKey 与 ctrlKey 归一为同一个 ctrl(⌘ 与 Ctrl 同义)', () => {
    expect(modsOf({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }).ctrl).toBe(true);
    expect(modsOf({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }).ctrl).toBe(true);
    expect(modsOf({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: true }).ctrl).toBe(true);
    expect(modsOf({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }).ctrl).toBe(false);
  });

  it('alt / shift 原样透传,不互相污染', () => {
    expect(modsOf({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toEqual({
      ctrl: false,
      alt: true,
      shift: false,
    });
    expect(modsOf({ ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toEqual({
      ctrl: false,
      alt: false,
      shift: true,
    });
  });

  it('归一后的状态直接喂给 modifierIntent:⌘ 单击 = Ctrl 单击', () => {
    const cmd = modsOf({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: true });
    expect(modifierIntent(cmd)).toBe('andAdd');
  });
});
