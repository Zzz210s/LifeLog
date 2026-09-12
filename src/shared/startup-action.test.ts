import { describe, expect, it } from 'vitest';
import { resolveStartupAction } from './startup-action';

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
