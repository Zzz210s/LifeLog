// @vitest-environment jsdom
/**
 * 统一输入框没有占位文案(精简批次 Task 4,R1):空输入时框里不显示提示文案 ——
 * 提示由下方提示行(PrefixHint)承担。
 * 无障碍名不退化:`aria-label` 是验收脚本(CDP 按它找框)与屏幕阅读器的唯一锚点,
 * 删占位文案不能把它一起删掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../shared/api', () => ({ api: { saveInputNote: async () => 1 } }));

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** 挂一个最小统一输入框(候选接线非必需:只有 Ctrl+P 那条路才用得上) */
async function mount(): Promise<HTMLTextAreaElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false })));
  return host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
}

describe('统一输入框:无占位文案', () => {
  it('空输入时 placeholder 为空或不存在,但 aria-label 仍在', async () => {
    const box = await mount();
    expect(box.getAttribute('placeholder') ?? '').toBe('');
    expect(box.getAttribute('aria-label')).toBe('统一输入框');
    expect(box.value).toBe('');
  });
});
