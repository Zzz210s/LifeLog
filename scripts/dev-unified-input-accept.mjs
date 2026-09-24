// Task 7 + 计划 2/3 Task 6 实机验收(第二批读数见 unified-accept-phases2.mjs);键鼠全走 CDP Input。
// 前置:pnpm tauri dev 已在 9222 上跑(origin http://localhost:5173,IPC 正常)。夹具(UI测试* 笔记 +
// UI测试 标签)自建自清,前后 notes/tags/tag_links/FTS 计数在外层用 lifelog-db-readings.py 比对。
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import {
  BOX, COMMAND_IDS, FIXTURE_TAG, HINT, RECORD_TEXT, SIDEBAR, STAT, TAB_GATED, cleanupFixtures, createFixtures, driver,
} from './unified-accept-lib.mjs';
import { phaseB } from './unified-accept-phases2.mjs';

const r = recorder();

async function main() {
  const conn = await ensureMain();
  const d = driver(conn.cdp);
  await conn.cdp.send('Page.reload');
  await waitFor(() => d.ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
  const sidebarBefore = await d.sidebar();

  // --- 夹具:三条笔记(两条带 UI测试 标签),走真实保存路径 ---
  const { target } = await createFixtures(d, r);

  // --- ① 布局:可见 input/textarea 只有统一输入框;侧栏没有输入框 ---
  const inputs = await d.visibleInputs();
  const sidebarInputs = await d.ev(`document.querySelectorAll('${SIDEBAR} input, ${SIDEBAR} textarea').length`);
  r.record('① 唯一可见输入框', inputs.length === 1 && inputs[0] === 'unified-input' && sidebarInputs === 0,
    `可见 input/textarea = ${JSON.stringify(inputs)}(期望 ["unified-input"]);侧栏内输入框 ${sidebarInputs} 个`);

  // --- ② 记录:Ctrl+Enter 落库 + 输入框清空 ---
  const recBefore = await d.hits(RECORD_TEXT);
  await d.clearBox();
  await d.type(RECORD_TEXT);
  await d.ctrlEnter();
  await sleep(700);
  const recAfter = await d.hits(RECORD_TEXT);
  const cleared = (await d.boxValue()) === '';
  r.record('② 记录 -> Ctrl+Enter', recBefore === 0 && recAfter === 1 && cleared,
    `库中「${RECORD_TEXT}」${recBefore} -> ${recAfter} 条;输入框清空=${cleared}`);

  // --- ③ `/` 实时筛选:300ms 后流条数 == 命中数,小字给命中数 ---
  await d.clearChips();
  await d.clearBox();
  const expect3 = await d.hits('UI测试');
  await d.type('/UI测试');
  const got3 = await waitFor(async () => { const n = await d.streamCount(); return n === expect3 ? n : null; }, 12, 250);
  const statText = await d.stat();
  const statNum = Number((statText ?? '').match(/命中 (\d+) 条/)?.[1] ?? -1);
  r.record('③ `/` 实时筛选', got3 === expect3 && statNum === expect3,
    `流条数=${await d.streamCount()} 期望命中=${expect3} stat="${statText}"`);

  // --- ④ `#` 标签:下拉出现 -> Enter -> 条件栏出现该 chip ---
  await d.clearChips();
  await d.clearBox();
  await d.type(`#${FIXTURE_TAG}`);
  const tagRows = await waitFor(async () => { const rs = await d.rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  await d.enter();
  await sleep(700);
  const chipTexts = await d.chips();
  r.record('④ `#` 采纳 -> 条件 chip', (chipTexts[0] ?? '').startsWith('⊢') && (chipTexts[0] ?? '').includes(`#${FIXTURE_TAG}`),
    `候选 ${tagRows?.length ?? 0} 行(首行 ${tagRows?.[0]?.label ?? '-'});chip=${JSON.stringify(chipTexts)}`);

  // --- ⑤ `>` 命令:候选行数 == 可用命令数;`>侧栏` 勾选态换边 ---
  // 注:命令表当前没有排序命令(`>最新` 属计划 2/3),这里用带勾选态的 sidebar.toggle 驱动。
  await d.clearChips();
  await d.clearBox();
  await d.type('>');
  const cmdRows = await d.rows();
  const tabCount = Number(await d.ev(`document.querySelector('[role="tablist"]')?.dataset.tabsCount ?? 0`));
  const expectCmds = COMMAND_IDS.length - (tabCount > 1 ? 0 : TAB_GATED.length);
  const unknown = cmdRows.filter((x) => !COMMAND_IDS.includes(x.id));
  await d.clearBox();
  await d.type('>侧栏');
  const beforeRow = (await d.rows())[0];
  await d.enter();
  await sleep(800);
  const hidden = await d.sidebar();
  await d.clearBox();
  await d.type('>侧栏');
  const afterRow = (await d.rows())[0];
  await d.enter();
  await sleep(800);
  const restored = await d.sidebar();
  const flipped = beforeRow?.label !== afterRow?.label && beforeRow?.checked !== afterRow?.checked;
  r.record('⑤ `>` 候选与勾选态', cmdRows.length === expectCmds && unknown.length === 0 && flipped && restored === sidebarBefore,
    `候选 ${cmdRows.length} 行(期望 ${expectCmds},标签页 ${tabCount} 个);未知 id ${unknown.length};` +
      `侧栏 ${beforeRow?.label}(checked=${beforeRow?.checked}) -> ${afterRow?.label}(checked=${afterRow?.checked});` +
      `可见 ${sidebarBefore}->${hidden}->${restored}`);

  // --- ⑥ `@` 打开笔记:下拉首项是被测笔记 -> Enter -> 滚进视野 ---
  await d.clearChips();
  await d.clearBox();
  await sleep(400);
  const scrolled = await d.scrollToBottom();
  const before6 = await d.noteInView(target.id);
  await d.type(`@${target.content.trim()}`);
  const openRows = await waitFor(async () => { const rs = await d.rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  await d.enter();
  await sleep(900);
  const after6 = await d.noteInView(target.id);
  r.record('⑥ `@` 采纳 -> 滚进视野',
    String(openRows?.[0]?.id) === String(target.id) && after6.found === true && after6.inView === true && before6.inView === false,
    `查询 @${target.content.trim()};首行 ${openRows?.[0]?.id}(期望 ${target.id});滚到底 scrollTop=${scrolled};` +
      `滚前 inView=${before6.inView} 滚后 inView=${after6.inView}(scrollTop=${after6.scrollTop})`);

  // --- ⑥b 负面读数:目标被筛掉时 `@` 采纳不再静默(清筛选 + 中文提示) ---
  await d.clearChips();
  await d.clearBox();
  await d.type('/UI测试夹具二'); // 只留夹具二,夹具三(被测目标)被筛掉
  await sleep(700);
  const stream6b = await d.streamCount();
  const before6b = await d.noteInView(target.id);
  await d.clearBox();
  await d.type(`@${target.content.trim()}`);
  await waitFor(async () => ((await d.rows()).length > 0 ? true : false), 12, 250);
  await d.enter();
  await sleep(1100);
  const hint6b = await d.alertText();
  const after6b = await d.noteInView(target.id);
  r.record('⑥b `@` 目标被筛掉 -> 不再静默',
    stream6b < expect3 && before6b.found === false && (hint6b ?? '').includes('已清除筛选') && after6b.inView === true,
    `筛选后流条数=${stream6b}(目标 ${target.id} 不在流);提示="${hint6b}";清筛选后 inView=${after6b.inView}`);
  await d.ev(`document.querySelector('[aria-label="关闭操作错误提示"]')?.click()`);

  // --- ⑦ 提示行:空闲四段;带前缀该段 data-active + 统计;点 `#` 段写进输入框且焦点回框 ---
  await d.clearBox();
  await sleep(250);
  const idleSegs = await d.hintSegs();
  const idleText = await d.ev(`document.querySelector('${HINT}')?.textContent ?? ''`);
  await d.type('/UI测试');
  const activeSeg = (await d.hintSegs()).find((s) => s.prefix === '/');
  const hasStat = await d.ev(`!!document.querySelector('${STAT}')`);
  await d.clearBox();
  await d.clickHint('#');
  await sleep(300);
  const clicked = await d.boxValue();
  const focused7 = await d.boxFocused();
  r.record('⑦ 提示行', idleSegs.length === 4 && idleText.includes('记点什么') && activeSeg?.active === 'true' && hasStat && clicked.startsWith('#') && focused7,
    `空闲四段=${JSON.stringify(idleSegs.map((s) => s.prefix))};/ 段 active=${activeSeg?.active} 有统计=${hasStat};点 # 段后输入框="${clicked}" 焦点在框=${focused7}`);

  // --- ⑧ Esc 两级:第一下只关下拉(模式/内容不变),再一下回记录模式 ---
  await d.clearBox();
  await d.type(`@${FIXTURE_TAG}`);
  await waitFor(async () => ((await d.rows()).length > 0 ? true : false), 12, 250);
  const value8 = await d.boxValue();
  await d.esc();
  await sleep(250);
  const esc1 = { rows: (await d.rows()).length, value: await d.boxValue() };
  await d.esc();
  await sleep(250);
  const esc2 = { rows: (await d.rows()).length, value: await d.boxValue() };
  r.record('⑧ Esc 两级', esc1.rows === 0 && esc1.value === value8 && esc2.rows === 0 && esc2.value === '',
    `第一下:下拉行 ${esc1.rows}、输入框="${esc1.value}";第二下:下拉行 ${esc2.rows}、输入框="${esc2.value}"`);

  // --- ⑨ 快捷键(Task 7 的主变更,8 条之外补的读数):Ctrl+Shift+P -> >,Ctrl+P -> @,且都抢焦点 ---
  await conn.cdp.send('Page.bringToFront');
  await d.clearBox();
  await d.ev(`document.querySelector('${BOX}').blur()`);
  await d.key(80, 'p', 'KeyP', 2 | 8); // Ctrl+Shift
  await sleep(350);
  const hot1 = { value: await d.boxValue(), focused: await d.ev(`document.activeElement === document.querySelector('${BOX}')`) };
  await d.clearBox();
  await d.ev(`document.querySelector('${BOX}').blur()`);
  await d.key(80, 'p', 'KeyP', 2); // Ctrl
  await sleep(350);
  const hot2 = { value: await d.boxValue(), focused: await d.ev(`document.activeElement === document.querySelector('${BOX}')`) };
  r.record('⑨ 快捷键聚焦预填', hot1.value === '>' && hot1.focused === true && hot2.value === '@' && hot2.focused === true,
    `Ctrl+Shift+P -> "${hot1.value}"(焦点=${hot1.focused});Ctrl+P -> "${hot2.value}"(焦点=${hot2.focused})`);

  // --- ⑩ combobox aria:开下拉时四属性自洽、无 role=list 中间层、计数播报随候选数 ---
  await d.clearChips();
  await d.clearBox();
  await d.type(`#${FIXTURE_TAG}`);
  const ariaRows = await waitFor(async () => { const rs = await d.rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  const a = await d.aria();
  const ariaOk = a.role === 'combobox' && a.expanded === 'true' && a.controls === a.listboxId && a.optExists === true &&
    a.hasInnerList === false && (a.childRoles ?? []).every((x) => x === 'presentation' || x === 'option' || x === 'group') &&
    a.live === `${ariaRows?.length ?? -1} 个候选`;
  r.record('⑩ combobox aria', ariaOk, `role=${a.role} expanded=${a.expanded} controls=${a.controls}/${a.listboxId} ` +
    `activedescendant=${a.activedescendant}(存在=${a.optExists}) 子 role=${JSON.stringify(a.childRoles)} live="${a.live}"`);
  await d.esc();
  await sleep(250);
  const off = await d.aria();
  r.record('⑩b 收起后 aria', off.expanded === 'false' && off.controls === null && off.activedescendant === null,
    `expanded=${off.expanded} controls=${off.controls} activedescendant=${off.activedescendant}`);

  await phaseB(d, r); // 第二批 5 条:条件栏瘦身 / 排序命令 / 顶栏溢出菜单 / 侧栏筛选标签

  // --- 清理:输入/条件/夹具笔记与标签 ---
  await cleanupFixtures(d, r);

  r.finish();
  conn.close();
}

main().catch((e) => {
  console.error('FAIL 脚本异常:', e?.message ?? e);
  process.exit(1); // 连接未关时事件循环不退出,异常路径必须硬退出(否则挂到超时)
});
