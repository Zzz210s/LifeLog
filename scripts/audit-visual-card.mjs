#!/usr/bin/env node
/**
 * 卡片三态审计(hover / focus-within):用 CDP 强制伪类读计算样式差,对照卡避开真实鼠标悬停的那张。
 * 抽成独立模块是为了守住 200 行红线(audit-visual-tokens.mjs 已顶格)。
 * 少于两张可见卡片时判失败并跳过 —— 直接取 nodeId 会拿到 undefined,CDP 调用会崩。
 */
import { BLUR_JS, CARD_STATE_JS, PICK_CARDS_JS, REAL_FOCUS_JS } from './audit-visual-scan.mjs';

export async function auditCardStates({ cdp, js, sleep, r }) {
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const pick = await js(PICK_CARDS_JS);
  const canPick = pick.target >= 0 && pick.ref >= 0;
  if (!canPick) {
    r.record(
      '卡片 hover 态(背景变化)',
      false,
      `需要至少两张可见卡片(target=${pick.target} ref=${pick.ref})——当前筛选把信息流收得太窄时无法对照`,
    );
    r.record('卡片 focus 态(键盘通道显形 + accent 环)', false, '同上:没有可对照的第二张卡片');
    return;
  }
  // 每次强制前重取 nodeId:HMR/重渲会让上一次的 nodeId 失效(失效时伪类作用在旧节点上,读数为假阴性)

  const force = async (list) => {

    const d = await cdp.send('DOM.getDocument', { depth: 1 });

    const ids = (await cdp.send('DOM.querySelectorAll', { nodeId: d.root.nodeId, selector: '#root ul li' })).nodeIds;

    await cdp.send('CSS.forcePseudoState', { nodeId: ids[pick.target], forcedPseudoClasses: list });

    await sleep(320);

  };

  const base = await js(CARD_STATE_JS(pick.target));

  const ref = await js(CARD_STATE_JS(pick.ref));

  await force(['hover']);

  const hover = await js(CARD_STATE_JS(pick.target));

  await force(['focus-within']);

  let focus = await js(CARD_STATE_JS(pick.target));

  if (focus?.actionOpacity !== '1') {

    await force(['focus-within']);

    focus = await js(CARD_STATE_JS(pick.target));

  }

  await force([]);

  const realFocus = await js(REAL_FOCUS_JS(pick.target));

  await js(BLUR_JS);

  r.record(

    '卡片 hover 态(背景变化)',

    !!hover && hover.bg === hover.hoverToken && ref?.bg === ref?.raisedToken,

    `静止卡 ${ref?.bg}(= --color-raised ${ref?.raisedToken}) -> 强制 hover ${hover?.bg}(= --color-hover ${hover?.hoverToken})`,

  );

  // 环:规则必须在(与 OS 焦点无关);窗口有焦点时再核对实时值

  // 实时环只作参考:脚本 focus() 不带键盘模态时 Chromium 不匹配 :focus-visible(实测 2026-10-02),
  // 所以判据是"环规则在样式表里"(ruleOk),而不是当场读到的那次 outline。
  const ringLive = realFocus?.outlineStyle === 'solid' && realFocus?.outlineColor === realFocus?.accent;

  r.record(

    '卡片 focus 态(键盘通道显形 + accent 环)',

    !!focus && focus.actionOpacity === '1' && ref?.actionOpacity === '0' && realFocus?.ruleOk === true,

    `操作行 opacity 对照卡 ${ref?.actionOpacity} -> focus-within ${focus?.actionOpacity};环规则 ${realFocus?.ruleOk ? '在' : '缺失'}(实时参考 ${realFocus?.outlineWidth} ${realFocus?.outlineStyle} ${realFocus?.outlineColor}${ringLive ? ',已匹配' : ',未匹配:脚本 focus 无键盘模态'})`,

  );

}
