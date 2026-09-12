import { describe, expect, it } from 'vitest';
import { parseStartupSettings, resolveAutostartStatus } from './startup-settings';

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
    expect(resolveAutostartStatus(false, false)).toBe('off');
    expect(resolveAutostartStatus(true, true)).toBe('on');
  });
  it('期望开但系统没有(或反之)需要修复', () => {
    expect(resolveAutostartStatus(true, false)).toBe('needs-repair');
    expect(resolveAutostartStatus(false, true)).toBe('needs-repair');
  });
});
