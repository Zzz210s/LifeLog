// 表达式验收的"读数场景"库(自 dev-cdp-accept-expr.mjs 拆出以守 200 行上限):
// 读数 1-6 的页面驱动与断言。所有页面动作经 ctx.x(window.__X),数据断言经 ctx.call(IPC)。
// 命名口径:自建标签全在 验收6/ 命名空间,笔记标记「验收六」,与 cleanup 的运行清单一致。
import { sleep } from './cdp-lib.mjs';

/** 测试标签引用(全部落在 验收6/ 命名空间内) */
export const T = (p) => '#验收6/' + p;
export const BAD = '#工作 AND'; // 末尾类错误:position = 7 = 字符数
export const E3 = `(${T('工作')} OR ${T('生活')}) AND NOT ${T('临时')}`;
export const E3A = `${T('工作')} AND NOT ${T('临时')}`;
/** 夹具:甲/乙 命中,丙 带被排除标签(负例),丁/戊 让 项目A/项目B 存在 */
export const FIXTURES = [
  `${T('工作')} 验收六甲`,
  `${T('生活')} 验收六乙`,
  `${T('工作')} ${T('临时')} 验收六丙`,
  `${T('项目A')} 验收六丁`,
  `${T('项目B')} 验收六戊`,
];
/** 与前端 filter-chips.ts 的 EXPR_TEXT_MAX 同口径(chip 可见文案截断,title 保留全文) */
export const MAX_EXPR_TEXT = 40;
export const trunc = (s) => ([...s].length <= MAX_EXPR_TEXT ? s : [...s].slice(0, MAX_EXPR_TEXT).join('') + '…');

/** 构造读者:ctx 提供页面动作与常用断言小工具(main 脚本里注入,便于两处复用) */
export function createReadings(ctx) {
  const { x, j, record, call, rows, listTags, waitX, waitFor, has, ids, norm, same } = ctx;

  /** 读数 1/2/2b:合法给绿色中文预览;非法红框 + 末尾文案 + 光标落点;非法时「确定」禁用 */
  async function read12() {
    await x('openExpr()');
    await x('fillExpr(' + j(E3) + ')');
    const s1 = await waitX('status()', (v) => v && v.kind === 'ok');
    record('读数1 合法表达式实时通过并给中文预览', !!s1 && s1.text.startsWith('预览:'), j(s1));
    await x('fillExpr(' + j(BAD) + ')');
    const s2 = await waitX('status()', (v) => v && v.kind === 'err');
    const ok = !!s2 && s2.text === '表达式末尾:缺少操作数' && s2.danger === true && s2.sel[0] === 7 && s2.sel[1] === 7;
    record('读数2 非法表达式红框 + 「表达式末尾:缺少操作数」+ 光标落点(下标 7)', ok, j(s2));
    const dis = await x('confirmDisabled()');
    record('读数2b 非法表达式时「确定」按钮处于禁用态', dis === true, j({ disabled: dis }));
  }

  /** 读数 3:非空夹具下 chips/摘要原文 + 表达式命中 == 等价结构化条件 + 被排除标签的笔记不出现 */
  async function read3(exId) {
    await x('openExpr()');
    await x('fillExpr(' + j(E3) + ')');
    await waitX('status()', (v) => v && v.kind === 'ok');
    await x("clickIn('表达式','确定')");
    const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label === '表达式:' + trunc(E3)));
    const chip = chips && chips.find((c) => c.label === '表达式:' + trunc(E3));
    const sum = await x('summary()');
    const dom = await x('texts()');
    const orRows = await rows({ expr: E3 });
    const orIds = ids(orRows);
    const uni = [];
    for (const leaf of ['工作', '生活']) {
      uni.push(...ids(await rows({ tags: [{ path: '验收6/' + leaf, includeChildren: true }] })));
    }
    const notRows = ids(await rows({ tags: [{ path: '验收6/临时', includeChildren: true }] }));
    const union = [...new Set(uni)].filter((id) => !notRows.includes(id)).sort((a, b) => a - b);
    const andExpr = ids(await rows({ expr: E3A }));
    const struct = ids(await rows({
      tags: [{ path: '验收6/工作', includeChildren: true }],
      excludeTags: [{ path: '验收6/临时', includeChildren: true }],
    }));
    // 非空夹具前置断言:两侧都必须真有命中,否则"逐 id 一致"是空洞成立
    const fixtureOk = orIds.length > 0 && union.length > 0 && notRows.includes(exId);
    // 负例:带被排除标签的笔记既不得进表达式命中,也不得出现在渲染列表里
    const notHit = !orIds.includes(exId) && !dom.some((t) => t.includes('验收六丙'));
    const domOk = orIds.length === dom.length && orRows.every((n) => has(dom, (t) => norm(t) === norm(n.content)));
    const ok = !!chip && chip.title === '表达式:' + E3 && !!sum && sum.text.includes(trunc(E3)) &&
      sum.title.includes(E3) && fixtureOk && same(orIds, union) && same(andExpr, struct) && domOk && notHit;
    record('读数3 非空夹具下 chips/摘要显示原文;OR 与结构化并集、AND 与 tags+excludeTags 逐 id 一致 + 负例不命中',
      ok, j({ chip, sum, dom, orIds, union, andExpr, struct, fixtureOk, domOk, notHit, exId }));
    return chips;
  }

  /** 读数 3b:非法表达式不写库 —— 「确定」被拒、对话框不关闭、filter_current / 条件 chips 快照前后一致 */
  async function read3b(chipsBefore) {
    // 先等读数 3 的合法条件落盘(500ms 节流窗口):否则拿 null 基线去比,
    // 会把读数 3 自己的迟到写入误判成"非法表达式写库"
    const settled = await waitFor(async () => {
      const v = await call('get_setting', { key: 'filter_current' });
      return v && String(v).includes(E3) ? { v } : null;
    }, 16, 250);
    const t0 = settled ? settled.v : await call('get_setting', { key: 'filter_current' });
    await x('openExpr()');
    await x('fillExpr(' + j(BAD) + ')');
    await waitX('status()', (v) => v && v.kind === 'err');
    const refused = await x("clickIn('表达式','确定')");
    const stillOpen = (await x('exprValue()')) === BAD;
    await x('esc()');
    await waitX('exprValue()', (v) => v === null, 8);
    await sleep(700); // 超过 500ms 写库节流窗口:若真有写库这里必然落盘
    const t1 = await call('get_setting', { key: 'filter_current' });
    const chipsSame = same(await x('chips()'), chipsBefore);
    record('读数3b 非法表达式不写库:「确定」被拒 + filter_current / 条件 chips 快照前后一致',
      refused === false && stillOpen && !!settled && t0 === t1 && chipsSame,
      j({ refused, stillOpen, settled: !!settled, before: t0, after: t1, chipsSame }));
  }

  /** 读数 4:点表达式 chip 再编辑、Esc 不保存(改过的文本丢弃)、删除 chip 后条件消失 */
  async function read4(before) {
    await x("clickChipButton('编辑条件')");
    const opened = await waitX('exprValue()', (v) => v !== null, 8);
    await x('fillExpr(' + j(T('生活')) + ')');
    await waitX('status()', (v) => v && v.kind === 'ok');
    await x('esc()');
    const closed = await waitX('exprValue()', (v) => v === null, 8);
    const kept = same(await x('chips()'), before);
    await x("clickChipButton('编辑条件')");
    const reopen = await waitX('exprValue()', (v) => v !== null, 8);
    await x("clickIn('表达式','取消')");
    await x("clickChipButton('移除条件')");
    const gone = await waitX('chipArea()', (v) => v === false, 8);
    record('读数4 表达式 chip 可再编辑 / Esc 不保存 / 删除该项后条件消失',
      opened === E3 && closed === null && kept && reopen === E3 && gone === false, j({ opened, closed, kept, reopen, gone }));
  }

  /** 读数 6:重启后表达式条件仍在(filter_current 读回 -> 条件 chips 复原) */
  async function readRestart() {
    const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label.startsWith('表达式:')), 16);
    const raw = await call('get_setting', { key: 'filter_current' });
    record('读数6 重启后表达式条件仍在(filter_current 持久化读回)',
      !!chips && has(chips, (y) => y.label === '表达式:' + trunc(E3)) && String(raw).includes(E3),
      j({ chips: chips && chips.map((c) => c.label), filterCurrent: raw }));
  }

  return { read12, read3, read3b, read4, readRestart };
}
