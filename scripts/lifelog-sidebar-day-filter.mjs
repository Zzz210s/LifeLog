// 补充验收(spec 5.2):点侧栏日级时间标签能筛出对应笔记(时间标签=普通标签,可当筛选入口)。
// 用法:release exe(9222)冷启动即可(脚本经 ensureMain 自动用托盘打开主窗)
//   node scripts/lifelog-sidebar-day-filter.mjs [时间标签路径]
// 根名不写死:从设置 time_tag_template 推导(见 cdp-lib 的 timeTagRoot);未给参数时
// 从库内真实标签里挑一个日级(根/年/月/日)节点,优先挑命中数 <= 一页 的,保证整页 = 全部命中。
import { ensureMain, sleep, waitFor, recorder, bindMain, timeTagRoot } from './cdp-lib.mjs';
import { clickModeOf, ensureClickMode, setClickMode } from './click-mode-lib.mjs';

const PAGE = 50; // 笔记流一页条数(与后端一致)
const r = recorder();
const { cdp: main, close } = await ensureMain();
const { call } = bindMain(main);
const selCount = () => main.eval(`document.querySelectorAll('[data-tag-path][aria-pressed="true"]').length`);
// 正文首行(title)前 6 字:markdown 列表项在 DOM 里会去掉 "- " 前缀,故只比对首行
const head6 = (s) => s.split('\n')[0].replace(/\s+/g, '').slice(0, 6);
const domHeads = () =>
  main.eval(`[...document.querySelectorAll('li .md-body')].slice(0, 3)
    .map((e) => (e.textContent || '').split(String.fromCharCode(10))[0].replace(/\\s+/g, '').slice(0, 6))`);

const root = await timeTagRoot(call);
// 筛选状态是落库的(settings.filter_current):收尾要把它还原为验收前的原文
const filterBefore = await call('get_setting', { key: 'filter_current' });
if (!root) {
  console.error('取不到时间标签根名(time_tag_template 为空或以 { 开头),中止');
  process.exit(2);
}
const tags = await call('list_tags');
const rootNode = tags.find((t) => t.path === root);
const dayDepth = (rootNode ? rootNode.depth : 1) + 3;
const auto = tags
  .filter((t) => t.path.startsWith(root + '/') && t.depth === dayDepth && t.self_count > 0)
  .sort((a, b) => Number(a.self_count > PAGE) - Number(b.self_count > PAGE) || b.self_count - a.self_count)[0];
const PATH = process.argv[2] ?? auto?.path;
if (!PATH) {
  console.error(`库内没有可用的日级时间标签(根=${root});可显式传入路径`);
  process.exit(2);
}
const tag = tags.find((t) => t.path === PATH);
console.log('时间标签根名', root, '目标日级标签', PATH, '库内根节点', JSON.stringify(rootNode ?? null));

// 侧栏单击模式:本脚本假定「点行 = 改条件」,这只在 filter 档成立 —— 开始前切到 filter。
// 2026-10-17 头部那颗按钮已删,模式读写走 click-mode-lib(库为真源,写入后重载);IPC 不可用 -> legacy,
// 由 D-1 显式记红而不是静默假通过。收尾拨回原值。
const modeBefore = await clickModeOf(main);
const modeAfter = modeBefore === 'legacy' ? 'legacy' : await ensureClickMode(main, 'filter');
r.record('D-1 单击模式切到 filter(点行 = 改条件的前提)', modeAfter === 'filter',
  `原模式=${JSON.stringify(modeBefore)} 切后=${JSON.stringify(modeAfter)}(legacy = IPC 读不到 sidebar_click_mode)`);

// 先逐个清掉上一次运行留下的选中态(每次点一个并重查,避免点到被重渲替换掉的旧节点)
let left = await selCount();
for (let i = 0; left > 0 && i < 8; i++) {
  await main.eval(`(() => { const x = document.querySelector('[data-tag-path][aria-pressed="true"]'); if (x) x.click(); return !!x; })()`);
  await sleep(500);
  left = await selCount();
}
r.record('D0 清空上一次的标签选中态(为本次单标签筛选铺底)', left === 0 && !!tag && tag.depth === dayDepth,
  `剩余选中=${left} 目标节点 self_count=${tag?.self_count} depth=${tag?.depth}(期望 ${dayDepth})`);

await main.eval(`document.querySelector('[data-tag-path=${JSON.stringify(PATH)}]').click()`);
const expected = await call('query_notes', {
  conditions: { keyword: null, tags: [{ path: PATH, includeChildren: false }], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
  offset: 0,
});
await waitFor(async () => ((await selCount()) === 1 ? true : null), 20, 250);
const back = expected.slice(0, 3).map((n) => head6(n.content));
const dom = await waitFor(async () => {
  const b = await domHeads();
  return b.length === back.length && b.join('|') === back.join('|') ? b : null;
}, 20, 300);
const chipShown = await main.eval(`(() => {
  const box = document.querySelector('[aria-label="已生效的筛选条件"]');
  return box ? box.textContent.includes(${JSON.stringify(root)}) : false;
})()`);
// 只查真正的笔记 li(流末尾还有一个无正文的哨兵 li);「每条笔记都带该标签」按 chip **文本**判:
// NoteChips 自 3834dd17 起不再给 title(只在文本被截断时给悬浮提示),故不能再按 title 查路径
const chipsOk = await main.eval(`[...document.querySelectorAll('li')].filter((li) => li.querySelector('.md-body')).every((li) =>
  [...li.querySelectorAll('button')].some((b) => (b.textContent || '').replace(/^#/, '').split('(')[0] === ${JSON.stringify(PATH)}))`);
r.record(
  `D1 点 ${PATH} 后笔记流按该标签筛出`,
  dom !== null && expected.length === tag.self_count && expected.length <= PAGE && chipShown === true && chipsOk === true,
  `DOM 前 ${back.length} 条正文首行=${JSON.stringify(dom)} 后端同条件=${JSON.stringify(back)}(共 ${expected.length} 条 = self_count ${tag.self_count},一页上限 ${PAGE}) 条件区出现该根名=${chipShown} 每条笔记都带该标签=${chipsOk} 点行时的单击模式=${await clickModeOf(main)}`
);

// 收尾还原:点掉本次点选产生的条件 chip,并等 filter_current 节流写回后与验收前原文对照
for (let i = 0; i < 8; i++) {
  const more = await main.eval(`(() => { const b = document.querySelector('[aria-label^="移除条件"]'); if (b) { b.click(); return true; } return false; })()`);
  if (!more) break;
  await sleep(400);
}
await sleep(1200);
const filterAfter = await call('get_setting', { key: 'filter_current' });
const modeRestored = modeBefore === 'filter' || modeBefore === 'legacy' || (await setClickMode(main, modeBefore)) === modeBefore;
r.record('D2 收尾:清掉本次筛选条件,filter_current 回到验收前原文(不留下筛选残留;单击模式拨回原值)',
  filterAfter === filterBefore && modeRestored,
  `before=${filterBefore} after=${filterAfter};单击模式 ${JSON.stringify(modeBefore)} -> ${JSON.stringify(await clickModeOf(main))}`);
r.finish();
close();
