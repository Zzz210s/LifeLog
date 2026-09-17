import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTKEY,
  effectiveAccelerator,
  formatAccelerator,
  formatKeys,
  hotkeyHint,
  normalizeAccelerator,
  normalizeParts,
  partsFromEvent,
} from './hotkey-display';

describe('formatAccelerator', () => {
  it('修饰键与主键用加号分隔的界面文案', () => {
    expect(formatAccelerator('ctrl+shift+q')).toBe('Ctrl + Shift + Q');
    expect(formatAccelerator('ctrl+shift+q')).toBe('Ctrl + Shift + Q');
    expect(formatAccelerator('alt+shift+l')).toBe('Alt + Shift + L');
    expect(formatAccelerator('super+alt+f2')).toBe('Alt + Super + F2');
  });
  it('功能键与命名键有惯用写法', () => {
    expect(formatAccelerator('f5')).toBe('F5');
    expect(formatAccelerator('ctrl+space')).toBe('Ctrl + 空格');
    expect(formatAccelerator('ctrl+escape')).toBe('Ctrl + Esc');
    expect(formatAccelerator('ctrl+arrowup')).toBe('Ctrl + 上');
  });
  it('非法或非规范的值按规范化/默认键显示', () => {
    expect(formatAccelerator('shift+ctrl+q')).toBe('Ctrl + Shift + Q');
    expect(formatAccelerator('control+KeyQ')).toBe('Ctrl + Q');
    expect(formatAccelerator('q')).toBe('Ctrl + Shift + Q');
    expect(formatAccelerator('')).toBe('Ctrl + Shift + Q');
  });
});

describe('formatKeys', () => {
  it('录制态原样展示刚按下的组合,不回退默认', () => {
    expect(formatKeys('q')).toBe('Q');
    expect(formatKeys('ctrl+alt+f9')).toBe('Ctrl + Alt + F9');
    expect(formatKeys('ctrl+shift')).toBe('Ctrl + Shift');
    expect(formatKeys('')).toBe('');
  });
});

describe('normalizeAccelerator', () => {
  it('合法组合规范化(H2/H3)', () => {
    expect(normalizeAccelerator('shift+ctrl+q')).toBe('ctrl+shift+q');
    expect(normalizeAccelerator('KeyQ+CTRL')).toBe('ctrl+q');
    expect(normalizeAccelerator('f24')).toBe('f24');
    expect(normalizeAccelerator('num0+ctrl')).toBe('ctrl+num0');
  });
  it('非法组合被拒', () => {
    for (const raw of ['', 'q', 'space', 'ctrl', 'ctrl+shift', 'ctrl+alt+shift+q', 'ctrl+q+z']) {
      expect(normalizeAccelerator(raw)).toBeNull();
    }
  });
});

describe('effectiveAccelerator', () => {
  it('缺失与非法一律回退默认', () => {
    expect(effectiveAccelerator(null)).toBe(DEFAULT_HOTKEY);
    expect(effectiveAccelerator(undefined)).toBe(DEFAULT_HOTKEY);
    expect(effectiveAccelerator('nope')).toBe(DEFAULT_HOTKEY);
    expect(effectiveAccelerator('ctrl+shift')).toBe(DEFAULT_HOTKEY);
  });
  it('合法值只做规范化', () => {
    expect(effectiveAccelerator('shift+ctrl+q')).toBe('ctrl+shift+q');
    expect(effectiveAccelerator('alt+shift+l')).toBe('alt+shift+l');
  });
});

describe('partsFromEvent', () => {
  it('修饰键在前、主键在后', () => {
    expect(
      partsFromEvent({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyQ' })
    ).toEqual(['ctrl', 'shift', 'q']);
    expect(
      partsFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: true, code: 'Space' })
    ).toEqual(['alt', 'super', 'space']);
    expect(
      partsFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'Digit5' })
    ).toEqual(['5']);
  });
  it('只按下修饰键本身时不产生主键', () => {
    expect(
      partsFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'ControlLeft' })
    ).toEqual(['ctrl']);
  });
});

describe('hotkeyHint', () => {
  it('非法组合给出中文原因', () => {
    expect(hotkeyHint(['q'])).toContain('F1-F24');
    expect(hotkeyHint([])).toBe('请按下快捷键');
    expect(hotkeyHint(['ctrl', 'shift'])).toContain('主键');
    expect(hotkeyHint(['ctrl', 'alt', 'shift', 'q'])).toContain('3 个键');
    expect(hotkeyHint(['ctrl', 'q', 'z'])).toContain('只能有一个主键');
  });
  it('合法组合没有提示', () => {
    expect(hotkeyHint(['ctrl', 'shift', 'q'])).toBe('');
    expect(hotkeyHint(['f5'])).toBe('');
  });
});

describe('normalizeParts', () => {
  it('忽略空片段并收敛重复修饰键', () => {
    expect(normalizeParts(['', 'ctrl', 'f5'])).toBe('ctrl+f5');
    expect(normalizeParts(['ctrl', 'ctrl', 'q'])).toBe('ctrl+q');
  });
});
