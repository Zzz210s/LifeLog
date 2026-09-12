import { describe, expect, it } from 'vitest';
import { parseStartupSettings, resolveAutostartStatus } from './startup-settings';

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
