import { describe, expect, it } from 'vitest';
import { CARD_DRAG_INSET_CSS, GLOW_PAD, MAX_WIDTH, MIN_WIDTH, SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS, cardEdgeBandCss, clampLines, clampWidth, clampWidthFrom, edgeBandCss, edgeSide, heightForLines, suggestListHeightCss } from './input-geometry';

describe('clampWidth', () => {
  it('钳制到 240-900', () => {
    expect(clampWidth(100)).toBe(MIN_WIDTH);
    expect(clampWidth(2000)).toBe(MAX_WIDTH);
    expect(clampWidth(500)).toBe(500);
  });

  it('边界值原样保留', () => {
    expect(clampWidth(MIN_WIDTH)).toBe(MIN_WIDTH);
    expect(clampWidth(MAX_WIDTH)).toBe(MAX_WIDTH);
    expect(clampWidth(239.6)).toBe(MIN_WIDTH);
    expect(clampWidth(899.6)).toBe(MAX_WIDTH);
  });

  it('非有限值回退到有方向的一侧', () => {
    expect(clampWidth(Number.NaN)).toBe(MIN_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(MAX_WIDTH);
    expect(clampWidth(Number.NEGATIVE_INFINITY)).toBe(MIN_WIDTH);
  });
});

describe('clampWidthFrom(拖动连续钳制)', () => {
  it('基线在 240-900 内时行为与硬钳制一致', () => {
    expect(clampWidthFrom(500, 100)).toBe(MIN_WIDTH);
    expect(clampWidthFrom(500, 2000)).toBe(MAX_WIDTH);
    expect(clampWidthFrom(500, 620.4)).toBe(620);
    expect(clampWidthFrom(500, Number.NaN)).toBe(MIN_WIDTH);
  });

  it('基线超过上限(缩放路径按工作区 80% 收口得到的 1228)时,小幅拖动不跳回 900', () => {
    // 2026-10-14 装机版实测:zoom 2.0、input_w 1100 落到 1536 物理像素 = 1228 逻辑宽,
    // 左边缘拖进 20 物理像素(=16 逻辑像素)时宽度从 1536 跳到 1125 物理像素(左边缘瞬移 411 像素)
    expect(clampWidthFrom(1228.8, 1228.8 - 16)).toBe(1213);
    expect(clampWidthFrom(1228.8, 1228.8 + 200)).toBe(1229); // 已经在工作区收口上:往区间外拖不动
    expect(clampWidthFrom(1228.8, 900)).toBe(900); // 朝区间内拖到哪就是哪(进入硬区间)
    expect(clampWidthFrom(1228.8, 239)).toBe(MIN_WIDTH);
  });

  it('基线低于下限(缩小后得到的 120)时,只能朝区间内连续长', () => {
    expect(clampWidthFrom(120, 120 - 50)).toBe(120); // 更小:不动
    expect(clampWidthFrom(120, 200)).toBe(200); // 连续长到 200,不跳到 240
    expect(clampWidthFrom(120, 2000)).toBe(MAX_WIDTH);
  });

  it('基线取不到(非有限)时退回硬区间', () => {
    expect(clampWidthFrom(Number.NaN, 700)).toBe(700);
    expect(clampWidthFrom(Number.POSITIVE_INFINITY, 100)).toBe(MIN_WIDTH);
  });
});

describe('clampLines', () => {
  it('1 到 5 行', () => {
    expect(clampLines(0)).toBe(1);
    expect(clampLines(3)).toBe(3);
    expect(clampLines(9)).toBe(5);
  });

  it('四舍五入后钳制', () => {
    expect(clampLines(1.4)).toBe(1);
    expect(clampLines(4.6)).toBe(5);
    expect(clampLines(Number.NaN)).toBe(1);
  });
});

describe('heightForLines', () => {
  it('按行高线性增长', () => {
    expect(heightForLines(1, 20)).toBe(20);
    expect(heightForLines(5, 20)).toBe(100);
  });

  it('支持小数行高', () => {
    expect(heightForLines(3, 22.75)).toBeCloseTo(68.25);
  });
});

describe('edgeSide', () => {
  it('左侧 8 CSS 像素带内为 left', () => {
    expect(edgeSide(3, 400, 8)).toBe('left');
  });
  it('右侧 8 CSS 像素带内为 right', () => {
    expect(edgeSide(396, 400, 8)).toBe('right');
  });
  it('内部为 null', () => {
    expect(edgeSide(200, 400, 8)).toBeNull();
  });

  it('左带优先于右带判定', () => {
    // 窄窗口时左右带重叠,退回左带,避免同一按下被两套逻辑抢
    expect(edgeSide(3, 12, 8)).toBe('left');
  });

  it('缩放 0.5/1/2 下热区换算为 16/8/4 CSS px', () => {
    expect(edgeBandCss(0.5)).toBe(16);
    expect(edgeBandCss(1)).toBe(8);
    expect(edgeBandCss(2)).toBe(4);
    expect(edgeBandCss(1.3)).toBeCloseTo(6.1538, 3);
  });

  it('非法 ratio 按 1 处理,不会把热区炸成 Infinity', () => {
    expect(edgeBandCss(0)).toBe(8);
    expect(edgeBandCss(-2)).toBe(8);
    expect(edgeBandCss(Number.NaN)).toBe(8);
    expect(edgeBandCss(Number.POSITIVE_INFINITY)).toBe(8);
  });

  it('换算后的带直接用于 edgeSide:0.5 缩放覆盖 16 CSS px,2.0 缩放只剩 4 CSS px', () => {
    expect(edgeSide(15, 400, edgeBandCss(0.5))).toBe('left');
    expect(edgeSide(16, 400, edgeBandCss(0.5))).toBeNull();
    expect(edgeSide(3, 400, edgeBandCss(2))).toBe('left');
    expect(edgeSide(4, 400, edgeBandCss(2))).toBeNull();
  });
});

describe('cardEdgeBandCss(可见卡片边缘带:上下带与左右带共用)', () => {
  it('拖动带覆盖光晕环与可见卡片内侧一小段(抓card边缘能拖)', () => {
    const band = GLOW_PAD + CARD_DRAG_INSET_CSS;
    expect(cardEdgeBandCss(2)).toBe(band);
    expect(cardEdgeBandCss(1.3)).toBe(band);
    expect(cardEdgeBandCss(0.5)).toBe(band); // 8 逻辑像素=16 < 20:新带在 0.5-2.0 全区间都够宽
    // 关键回归:卡片可见边缘恰好落在 GLOW_PAD 处,必须落在拖动带内(否则“拖不动”)
    expect(GLOW_PAD).toBeLessThan(band);
    expect(GLOW_PAD + CARD_DRAG_INSET_CSS).toBeLessThanOrEqual(band);
  });

  it('0.5-2.0 缩放抓可见卡片边缘(GLOW_PAD 处)都判进左/右带', () => {
    // 2026-10-14 装机版实测的坑:左右带原先只认 edgeBandCss(屏幕空间常量,物理宽度恒 8 x 系统缩放),
    // 而可见边缘在页面空间恒在 14 CSS px 处,缩放 >= 0.57 起 hot zone 整条落在可见边缘之外 ——
    // zoom 1.0/2.0 下抓可见边缘拖动,窗口被移动而宽度不变
    for (const ratio of [0.5, 0.75, 1, 1.3, 1.5, 2]) {
      const band = cardEdgeBandCss(ratio);
      expect(edgeSide(GLOW_PAD, 480, band)).toBe('left');
      expect(edgeSide(480 - GLOW_PAD, 480, band)).toBe('right');
      // 反面:左侧旧热区在高缩放下已经够不着可见边缘(这条正是回归的判别点)
      if (ratio >= 1) expect(edgeSide(GLOW_PAD, 480, edgeBandCss(ratio))).toBeNull();
    }
  });

  it('带不伸进文字区:左侧带末端仍在输入框左内边距(12 CSS px)之前', () => {
    expect(cardEdgeBandCss(0.5)).toBeLessThan(GLOW_PAD + 12);
    expect(cardEdgeBandCss(2)).toBeLessThan(GLOW_PAD + 12);
  });
});

describe('suggestListHeightCss(# 补全建议列表)', () => {
  it('0 条不加高;条数决定高度;超过上限按上限(候选条数本身也被限在同值)', () => {
    expect(suggestListHeightCss(0)).toBe(0);
    expect(suggestListHeightCss(-3)).toBe(0);
    expect(suggestListHeightCss(Number.NaN)).toBe(0);
    expect(suggestListHeightCss(1)).toBe(SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
    expect(suggestListHeightCss(3)).toBe(3 * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
    expect(suggestListHeightCss(SUGGEST_MAX_ROWS)).toBe(SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
    expect(suggestListHeightCss(50)).toBe(SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
  });
  it('上限与 tag-complete 的候选上限同值(8 条,两处漂移会让列表被裁或滚不动)', () => {
    expect(SUGGEST_MAX_ROWS).toBe(8);
  });
});
