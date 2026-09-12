import { describe, expect, it } from 'vitest';
import {
  INPUT_DEFAULTS,
  INPUT_KEYS,
  parseInputSettings,
  serializeInputSetting,
} from './input-settings';

describe('parseInputSettings', () => {
  it('空对象得到默认值(置顶开、失焦不隐、锁定全关、双击隐藏)', () => {
    expect(parseInputSettings({})).toEqual(INPUT_DEFAULTS);
  });
  it('空字符串与非法值一律回退默认值', () => {
    const s = parseInputSettings({
      input_always_on_top: '',
      input_zoom_step: 'abc',
      input_default_opacity: '',
      input_double_click_action: 'nonsense',
    });
    expect(s.alwaysOnTop).toBe(true);
    expect(s.zoomStep).toBe(10);
    expect(s.defaultOpacity).toBe(100);
    expect(s.doubleClickAction).toBe('hide');
  });
  it('数值钳制:透明度 30-100、步长 1-50', () => {
    expect(parseInputSettings({ input_default_opacity: '5' }).defaultOpacity).toBe(30);
    expect(parseInputSettings({ input_zoom_step: '999' }).zoomStep).toBe(50);
    expect(parseInputSettings({ input_opacity_step: '0' }).opacityStep).toBe(1);
  });
  it('布尔只认小写 true', () => {
    expect(parseInputSettings({ input_lock_move: 'TRUE' }).lockMove).toBe(false);
    expect(parseInputSettings({ input_lock_move: 'true' }).lockMove).toBe(true);
  });
  it('科学计数法与十六进制不进数值分支', () => {
    expect(parseInputSettings({ input_zoom_step: '1e3' }).zoomStep).toBe(10);
    expect(parseInputSettings({ input_zoom_step: '0x10' }).zoomStep).toBe(10);
    expect(parseInputSettings({ input_zoom_step: ' 12 ' }).zoomStep).toBe(12);
  });
  it('失焦隐藏与双击动作按字面解析', () => {
    expect(parseInputSettings({ input_hide_on_blur: 'true' }).hideOnBlur).toBe(true);
    expect(parseInputSettings({ input_double_click_action: 'none' }).doubleClickAction).toBe(
      'none',
    );
  });
});

describe('serializeInputSetting', () => {
  it('布尔与数值序列化', () => {
    expect(serializeInputSetting('lockClose', true)).toBe('true');
    expect(serializeInputSetting('opacityStep', 7.4)).toBe('7');
  });
  it('布尔 false 与数值四舍五入', () => {
    expect(serializeInputSetting('alwaysOnTop', false)).toBe('false');
    expect(serializeInputSetting('zoomStep', 12.6)).toBe('13');
  });
  it('双击动作按字面写回', () => {
    expect(serializeInputSetting('doubleClickAction', 'none')).toBe('none');
  });
});

describe('INPUT_KEYS', () => {
  it('九个键与字段一一对应且无重复', () => {
    const keys = Object.values(INPUT_KEYS);
    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(9);
    expect(Object.keys(INPUT_KEYS).sort()).toEqual(Object.keys(INPUT_DEFAULTS).sort());
  });
});
