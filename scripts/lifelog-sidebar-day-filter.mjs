// 补充验收(spec 5.2):点侧栏日级时间标签能筛出对应笔记(时间标签=普通标签,可当筛选入口)。
// 用法:release exe(9222)+ 托盘打开主窗后
//   node scripts/lifelog-sidebar-day-filter.mjs 时间排序/2026/03/28
import { open, sleep, waitFor, recorder } from './cdp-lib.mjs';

const PATH = process.argv[2] ?? '时间排序/2026/09/14';
const PAGE = 50; // 笔记流一页条数(与后端一致)
const r = recorder();
const { cdp: main, close } = await open('main');
const call = (cmd, args = {}) =>
  main.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const selCount = () => main.eval(`document.querySelectorAll('[data-tag-path][aria-pressed="true"]').length`);
// 正文首行(title)前 6 字:markdown 列表项在 DOM 里会去掉 "- " 前缀,故只比对首行
const head6 = (s) => s.split('\n')[0].replace(/\s+/g, '').slice(0, 6);
const domHeads = () =>
  main.eval(`[...document.querySelectorAll('li .md-body')].slice(0, 3)
    .map((e) => (e.textContent || '').split(String.fromCharCode(10))[0].replace(/\\s+/g, '').slice(0, 6))`);

// 先逐个清掉上一次运行留下的选中态(每次点一个并重查,避免点到被重渲替换掉的旧节点)
let left = await selCount();
for (let i = 0; left > 0 && i < 8; i++) {
  await main.eval(`(() => { const x = document.querySelector('[data-tag-path][aria-pressed="true"]'); if (x) x.click(); return !!x; })()`);
  await sleep(500);
  left = await selCount();
}
const tag = (await call('list_tags')).find((t) => t.path === PATH);
const want = Math.min(PAGE, tag.self_count);
r.record('D0 清空上一次的标签选中态(为本次单标签筛选铺底)', left === 0 && !!tag && tag.depth === 4, `剩余选中=${left} 目标节点 self_count=${tag?.self_count}`);

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
  return box ? box.textContent.includes('时间排序') : false;
})()`);
// 只查真正的笔记 li(流末尾还有一个无正文的哨兵 li)
const chipsOk = await main.eval(`[...document.querySelectorAll('li')].filter((li) => li.querySelector('.md-body')).every((li) =>
  [...li.querySelectorAll('button')].some((b) => (b.getAttribute('title') || '') === ${JSON.stringify(PATH)}))`);
r.record(
  `D1 点 ${PATH} 后笔记流按该标签筛出`,
  dom !== null && expected.length === want && chipShown === true && chipsOk === true,
  `DOM 前 ${back.length} 条正文首行=${JSON.stringify(dom)} 后端同条件=${JSON.stringify(back)}(共 ${expected.length} 条,期望 ${want}=min(50, self_count)) 条件区出现该标签=${chipShown} 每条笔记都带该标签=${chipsOk}`
);
r.finish();
close();
