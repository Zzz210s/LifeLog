// 外观段落的数据模型:三行元数据、8 键恢复默认、透明度提示阈值、底色文案差异。
import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEYS } from '../../shared/input-appearance';
import {
  appearanceResetKeys,
  appearanceRows,
  bgHint,
  opacityWarning,
} from './input-appearance-model';

describe('外观段落的数据模型', () => {
  it('三个数值行的 key/label/hint 都非空且顺序固定', () => {
    const rows = appearanceRows();
    expect(rows.map((r) => r.key)).toEqual(['radius', 'shadow', 'opacity']);
    for (const row of rows) {
      expect(row.label).not.toBe('');
      expect(row.hint).not.toBe('');
    }
  });

  it('元数据是浅拷贝,调用方改不到真源', () => {
    const first = appearanceRows();
    first[0].label = '改过';
    expect(appearanceRows()[0].label).toBe('圆角');
  });

  it('恢复默认的键集是 8 个,与 APPEARANCE_KEYS 完全一致', () => {
    const keys = appearanceResetKeys();
    expect(keys).toHaveLength(8);
    expect([...keys].sort()).toEqual(Object.keys(APPEARANCE_KEYS).sort());
  });

  it('透明度低于 40 才给提示', () => {
    expect(opacityWarning(0)).toContain('看不清');
    expect(opacityWarning(39)).toContain('看不清');
    expect(opacityWarning(40)).toBeNull();
    expect(opacityWarning(100)).toBeNull();
  });

  it('主题底色与自定义底色的说明不同,透明单独一句', () => {
    expect(bgHint('theme')).not.toBe(bgHint('#123456'));
    expect(bgHint('#123456')).toContain('4.5:1');
    expect(bgHint('transparent')).toContain('透明');
  });
});
