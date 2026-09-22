/**
 * 应用内快捷键匹配的断言 + 共享向量(fixtures/hotkey-spec.json)。
 * `cases` 是键名片段 -> 规范化的契约(与 Rust `hotkey_spec::validate` 同规则,
 * 后续任务在 Rust 侧读同一段);`events` 是 DOM 事件面(TS 独有)。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeParts } from './hotkey-display';
import {
  APP_HOTKEY_KEYS,
  DEFAULT_APP_HOTKEYS,
  acceleratorFromEvent,
  effectiveAppHotkey,
  matchesHotkey,
} from './hotkey-match';
import type { KeyEventLike } from './hotkey-match';

interface Case {
  why: string;
  keys: string[];
  normalized: string | null;
}
interface EventCase {
  why: string;
  event: KeyEventLike;
  stored: string | null;
  match: boolean;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/hotkey-spec.json', import.meta.url), 'utf8'),
) as { cases: Case[]; events: EventCase[] };

describe('hotkey-spec.json:键名片段 -> 规范化(与 Rust 同规则)', () => {
  it('向量条数达标且字段齐全', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
    expect(fixture.events.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture.cases) {
      expect(Array.isArray(c.keys), c.why).toBe(true);
      expect(c.normalized === null || typeof c.normalized === 'string', c.why).toBe(true);
    }
  });

  it('每条向量都被 normalizeParts 真实跑过', () => {
    for (const c of fixture.cases) {
      expect(normalizeParts(c.keys), c.why).toBe(c.normalized);
    }
  });
});

describe('hotkey-match:事件 -> 加速键', () => {
  it('修饰键序与主键名规范化(含插件 code 别名)', () => {
    expect(acceleratorFromEvent(evt({ ctrlKey: true, shiftKey: true, code: 'KeyP' }))).toBe(
      'ctrl+shift+p',
    );
    expect(acceleratorFromEvent(evt({ metaKey: true, code: 'Digit5' }))).toBe('super+5');
    expect(acceleratorFromEvent(evt({ altKey: true, code: 'Space' }))).toBe('alt+space');
    expect(acceleratorFromEvent(evt({ code: 'F5' }))).toBe('f5');
  });

  it('非法组合返回 null:只按修饰键、单普通键、超 3 键', () => {
    expect(acceleratorFromEvent(evt({ ctrlKey: true, code: 'ControlLeft' }))).toBeNull();
    expect(acceleratorFromEvent(evt({ code: 'KeyA' }))).toBeNull();
    expect(
      acceleratorFromEvent(evt({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true, code: 'KeyP' })),
    ).toBeNull();
  });
});

describe('hotkey-match:与存储键值比较', () => {
  it('向量里每条事件的命中判定逐条成立', () => {
    for (const c of fixture.events) expect(matchesHotkey(c.event, c.stored), c.why).toBe(c.match);
  });

  it('存储值缺失或非法时不命中(默认值由调用方补)', () => {
    const p = evt({ ctrlKey: true, code: 'KeyP' });
    expect(matchesHotkey(p, null)).toBe(false);
    expect(matchesHotkey(p, undefined)).toBe(false);
    expect(matchesHotkey(p, '不是键名')).toBe(false);
    expect(matchesHotkey(p, 'a')).toBe(false);
  });

  it('默认值与设计 §3.6 一致,且默认键自身能命中', () => {
    expect(DEFAULT_APP_HOTKEYS).toEqual({ palette: 'ctrl+shift+p', quickOpen: 'ctrl+p' });
    expect(matchesHotkey(evt({ ctrlKey: true, shiftKey: true, code: 'KeyP' }), DEFAULT_APP_HOTKEYS.palette)).toBe(true);
    expect(matchesHotkey(evt({ ctrlKey: true, code: 'KeyP' }), DEFAULT_APP_HOTKEYS.quickOpen)).toBe(true);
    expect(matchesHotkey(evt({ ctrlKey: true, code: 'KeyP' }), DEFAULT_APP_HOTKEYS.palette)).toBe(false);
  });
});

describe('effectiveAppHotkey:缺失/非法一律回退默认(T3 审查 M7)', () => {
  it('缺失(undefined/null)回退默认', () => {
    expect(effectiveAppHotkey(undefined, 'palette')).toBe('ctrl+shift+p');
    expect(effectiveAppHotkey(null, 'quickOpen')).toBe('ctrl+p');
  });

  it('非法值回退默认,合法值规范化后采用', () => {
    expect(effectiveAppHotkey('不是键名', 'palette')).toBe('ctrl+shift+p');
    expect(effectiveAppHotkey('a', 'quickOpen')).toBe('ctrl+p'); // 单普通键非法
    expect(effectiveAppHotkey('Ctrl+Alt+K', 'palette')).toBe('ctrl+alt+k');
    expect(effectiveAppHotkey(' win + Digit5 ', 'quickOpen')).toBe('super+5');
  });

  it('生效值一定能被同一事件命中,非法存储值不会死键', () => {
    const alt = evt({ ctrlKey: true, altKey: true, code: 'KeyK' });
    expect(matchesHotkey(alt, effectiveAppHotkey('ctrl+alt+k', 'palette'))).toBe(true);
    expect(matchesHotkey(alt, effectiveAppHotkey('不是键名', 'palette'))).toBe(false);
  });
});

describe('存储键名与默认值同处一源(T3 审查 M6)', () => {
  it('键名常量与设计 §3.6 一致,且每种 kind 都有键名与默认值', () => {
    expect(APP_HOTKEY_KEYS).toEqual({
      palette: 'main_palette_hotkey',
      quickOpen: 'main_quick_open_hotkey',
    });
    for (const kind of ['palette', 'quickOpen'] as const) {
      expect(APP_HOTKEY_KEYS[kind]).not.toBe('');
      expect(effectiveAppHotkey(undefined, kind)).toBe(DEFAULT_APP_HOTKEYS[kind]);
    }
  });
});

function evt(over: Partial<KeyEventLike> & { code: string }): KeyEventLike {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over };
}
