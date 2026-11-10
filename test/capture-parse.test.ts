import { describe, expect, it } from 'vitest';
import { parseCapture, parentOfTag } from '../src/capture/parse';

describe('parseCapture', () => {
  it('拆出标签与链接，正文保留其余', () => {
    const c = parseCapture('去办了驾照 #地点/印度 [[印尼驾照换发]]');
    expect(c.tags).toEqual(['地点/印度']);
    expect(c.links).toEqual(['印尼驾照换发']);
    expect(c.body).toBe('去办了驾照');
  });

  it('斜杠命令与父级前缀都不进正文', () => {
    const c = parseCapture('/日记 >时间/2026/10 今天很累');
    expect(c.commands).toEqual(['日记']);
    expect(c.parent).toBe('时间/2026/10');
    expect(c.body).toBe('今天很累');
  });

  it('链接的显示别名被剥掉', () => {
    expect(parseCapture('见 [[印度|印度尼西亚]] 的记录').links).toEqual(['印度']);
  });

  it('空输入不抛错', () => {
    expect(parseCapture('   ')).toEqual({ body: '', tags: [], links: [], commands: [], parent: null });
  });

  it('parentOfTag 只切最后一段', () => {
    expect(parentOfTag('地点/东南亚/印度')).toBe('地点/东南亚');
    expect(parentOfTag('地点')).toBeNull();
  });
});
