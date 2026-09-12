import { describe, expect, it } from 'vitest';
import { canClose, canDrag, canEdit, emptyLock, lockStateFrom } from './quick-lock';

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
});

describe('emptyLock', () => {
  it('全解锁', () => {
    expect(emptyLock()).toEqual({ move: false, close: false, content: false });
  });
});
