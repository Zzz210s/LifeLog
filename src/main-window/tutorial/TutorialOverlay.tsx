/**
 * 覆盖层:四个半透明矩形(上/下/左/右)拼出洞口 + 一层吞点击的透明底板。
 *
 * 刻意**不**提升目标元素的 z-index、**不**用 box-shadow 技巧 —— 那会与卡片的 hover / 选中 /
 * :focus-visible 抢 stacking context(设计 3.2)。四块矩形彼此不重叠:重叠处会压暗两次。
 * 洞口内不压暗,但**不放行**点击(底板盖住整屏,含洞口),引导是模态的。
 * 洞口 4px 圆角(设计 3.2)实现不了:四块矩形要出圆角得再叠四块角片,角片与相邻矩形必然
 * 重叠 -> 那四处压暗两次。取舍:不圆角,保住"各处压暗一致"。
 */
import type { ReactNode } from 'react';
import type { Rect } from './tutorial-layout';

/** 与对话框遮罩同一档令牌 */
const DIM = 'absolute bg-overlay';

/** 洞口外的四块遮罩(strip 上/下/左/右) */
function Bands({ hole }: { hole: Rect }): ReactNode {
  const top = Math.max(0, hole.top);
  const band = { top: hole.top, height: Math.max(0, hole.height) };
  return (
    <>
      <div className={DIM + ' left-0 right-0 top-0'} style={{ height: top }} />
      <div className={DIM + ' left-0 right-0 bottom-0'} style={{ top: hole.top + hole.height }} />
      <div className={DIM + ' left-0'} style={{ ...band, width: Math.max(0, hole.left) }} />
      <div className={DIM + ' right-0'} style={{ ...band, left: hole.left + hole.width }} />
    </>
  );
}

export function TutorialOverlay({ hole }: { hole: Rect | null }): ReactNode {
  return (
    <div data-testid="tutorial-root" className="absolute inset-0 z-40">
      {/* 透明底板:盖住洞口那块空白,吃掉落在引导上的所有点击/滚轮(不放行到下层)。
          点它不退出(防误触):退出只有完成 / 跳过 / Esc 三条用户动作。
          `onMouseDown` preventDefault:点它不会把焦点丢给 body(focusin 拓不回来)。 */}
      <div
        data-testid="tutorial-scrim"
        className="absolute inset-0"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      />
      {hole === null ? <div className={DIM + ' inset-0'} /> : <Bands hole={hole} />}
    </div>
  );
}
