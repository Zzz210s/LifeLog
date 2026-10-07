// 视觉令牌审计的分组组头读数(T5 新组件登记点)。
// 组头是列表行档:rounded-xs(4px)+ --text-ui(13px),整行是原生 button(可聚焦、Enter/Space 可切)。
// 分组未开启时无组头 —— 报「跳过」而不是假绿:在分组模式下重跑 pnpm verify 才覆盖到。
const HEADER = '#root [data-testid="group-header"]';

const JS = `(() => {
  const el = document.querySelector('${HEADER}');
  const all = [...document.querySelectorAll('${HEADER}')];
  if (!el) return { count: 0 };
  const c = getComputedStyle(el);
  return {
    count: all.length,
    tag: el.tagName,
    tabIndex: el.tabIndex,
    expanded: el.getAttribute('aria-expanded'),
    fontSize: c.fontSize,
    radius: c.borderRadius,
    sections: document.querySelectorAll('#root [data-testid="group-section"]').length,
  };
})()`;

export async function recordGroupHeader(js, r) {
  const g = await js(JS);
  const present = g && g.count > 0;
  r.record(
    '分组组头 = 列表行档(rounded-xs / --text-ui / 可聚焦按钮)',
    !present ||
      (g.tag === 'BUTTON' && g.tabIndex >= 0 && g.fontSize === '13px' && g.radius === '4px' && g.expanded !== null),
    present
      ? `${g.count} 个组头(${g.sections} 个分组),${g.tag} ${g.fontSize}/${g.radius},aria-expanded=${g.expanded}`
      : '未分组,组头读数跳过(在分组模式下重跑 verify 才覆盖)',
  );
}
