// 验收脚本登记表(架构精简 D,2026-10-27)。
//
// 127 个脚本原先没有入口:要跑某一条得先翻目录、猜它依赖哪个环境(装机版 / dev 侧车 / 纯数据库)。
// 这里把每条登记成一行:`需要什么环境`、`判什么据`、`是否写库`、`是否已废弃`。
// 运行器见 `run.mjs`:`pnpm accept [--only 过滤] [--list] [--env app] [--include-write]`。
//
// 每条的标记:
//   write=true      写库脚本(默认不跑,`--include-write` 才跑)
//   obsolete=true   已废弃(默认不跑)
//   needsArgs='…'   必须带参数才有意义(运行器判 SKIP 并打印用法)
//   slow=true       单条超过 1 分钟(仍会跑,只是提示)
//   stale='原因'    已知陈旧:断言口径落后于产品改动,判定为 STALE 而非 FAIL(`--strict` 才当失败)
//
// 环境四档:
//   node = 纯 Node 自检(不起应用、不碰库)
//   db   = 只读真库/副本,不需要应用在跑
//   app  = 需要装机版在 CDP 端口上(默认 9222)
//   dev  = 需要 vite + debug exe(dev 侧车,记忆 #1543 的启动姿势)
export const ENVS = ['node', 'db', 'app', 'dev'];

export const SCRIPTS = [
  // —— 数据层 / 迁移对账(不需要应用)—— //
  { name: 'entity-migration/reconcile', env: 'db', why: '十条不变量对账(真库或副本)' },
  { name: 'entity-migration/verify-031', env: 'db', why: '迁移 031 视图与计数等价性', slow: true },
  { name: 'entity-migration/e2e', stale: '③b 比对用的已迁副本是 745 节点之前的(baseline 陈旧),① 对账在 v33 上多一条 FAIL', env: 'app', why: '点/线模型端到端(10 条)' },
  { name: 'entity-migration/verify-time-axis', env: 'db', why: '时间轴收敛 S1+S2 读数', needsArgs: '--phase tree|created-at|both' },
  { name: 'entity-migration/time-axis-readout', env: 'db', why: '时间轴只读读数', needsArgs: '--db <路径>' },
  { name: 'entity-migration/snapshot', env: 'db', why: 'VACUUM INTO 快照' },
  { name: 'db-snapshot', env: 'db', why: '库快照' },
  { name: 'db-compat.test', env: 'node', why: '兼容视图自检' },

  // —— 交互验收(需装机版 + CDP)—— //
  { name: 'dev-links-accept', stale: '夹具建笔记偶发失败(应用侧慢查询超时,重跑即过)—— 未定性', env: 'app', why: '引用/标签链路 6 条' },
  { name: 'dev-links-accept-l2', env: 'app', why: '引用 L2' },
  { name: 'dev-links-accept-l3', env: 'app', why: '引用 L3(卡片无被引用徽标)' },
  { name: 'dev-links-accept-l4', env: 'app', why: '引用 L4' },
  { name: 'dev-links-accept-n2', env: 'app', why: '引用 N2' },
  { name: 'dev-links-accept-n3', stale: '候选标题现在带「树外」后缀(产品新增标记),断言未跟随', env: 'app', why: '引用 N3' },
  { name: 'dev-links-accept-n4', env: 'app', why: '引用 N4' },
  { name: 'dev-carry-accept', env: 'app', why: '关系/携带 16 条' },
  { name: 'dev-relations-accept', env: 'app', why: '关系面板 12 条' },
  { name: 'dev-graph-accept', env: 'dev', why: '关系图视觉与载荷(要读源码模块,只能 dev 构建)' },
  { name: 'accept-sort-group', env: 'app', why: '排序/条件组/分组 17 条' },
  { name: 'accept-sort-group-ui', env: 'app', why: '排序分组界面' },
  { name: 'batch-accept', env: 'app', why: '批量加/去标签、删除、导出' },
  { name: 'clickmode-accept', stale: 'B2/B3/B6 仍按「Ctrl=AND 追加 / Shift=只看这条」断言,2026-10-25 已改为 VS Code 多选语义', env: 'app', why: '侧栏单击两档' },
  { name: 'clickmode-accept-gesture', env: 'app', why: '侧栏手势(修饰键)' },
  { name: 'clickmode-accept-row', env: 'app', why: '侧栏行意图表' },
  { name: 'dev-no-tabs-accept', env: 'app', why: '无标签页(视图导航)' },
  { name: 'dev-table-edit-accept', env: 'app', why: '表格就地编辑' },
  { name: 'dev-scroll-behavior', env: 'app', why: '滚动行为' },
  { name: 'dev-scroll-geometry', env: 'app', why: '滚动几何' },
  { name: 'dev-issue36-accept', env: 'app', why: 'issue 36 回归' },
  { name: 'dev-accept-3fix', env: 'app', why: '三处修复回归' },
  { name: 'dev-cdp-accept-drag', env: 'app', why: '拖拽' },
  { name: 'dev-cdp-accept-regress', stale: 'R5「无标签」后端命中 0 而界面 50(域口径变更);R7 断言「九个分区」而设置页已 10 个', env: 'app', why: '回归批 1' },
  { name: 'dev-cdp-accept-regress2', env: 'app', why: '回归批 2(无限滚动等)' },
  { name: 'lifelog-release-smoke', env: 'app', why: '装机版冒烟 6 条' },
  { name: 'table-edit-release-smoke', env: 'app', why: '表格编辑冒烟' },
  { name: 'dev-icons-shots', env: 'app', why: '顶栏图标截图' },
  { name: 'dev-group-shots', env: 'app', why: '分组截图' },

  // —— 性能与探针(需 dev 侧车)—— //
  { name: 'dev-perf-firstframe', env: 'dev', why: '首帧耗时' },
  { name: 'dev-perf-firstopen', env: 'dev', why: '首次打开' },
  { name: 'dev-perf-mainopen', env: 'dev', why: '主窗打开' },
  { name: 'dev-perf-startup', env: 'dev', why: '启动耗时' },
  { name: 'dev-perf-inputbar', env: 'dev', why: '输入栏性能' },
  { name: 'dev-perf-inputbar-page', env: 'dev', why: '输入栏页载' },
  { name: 'dev-perf-inputbar-out', env: 'dev', why: '输入栏唤出' },
  { name: 'dev-perf-inputbar-nojs', env: 'dev', why: '输入栏无 JS 基线' },
  { name: 'dev-dnd-probe', env: 'dev', why: '拖拽探针' },
  { name: 'dev-dnd-after-probe', env: 'dev', why: '拖拽后探针' },
  { name: 'dev-save-outside-probe', env: 'dev', why: '窗外保存探针' },
  { name: 'chunk-attribution', env: 'dev', why: '包体分块归因' },

  // —— 数据写入脚本:默认 dry-run,不进一键跑 —— //
  { name: 'place-flatten-ops', env: 'db', why: '历史:地点扁平化(dry-run)', write: true },
  { name: 'place-verb-ops', env: 'db', why: '历史:动词地名拆分(dry-run)', write: true },
  { name: 'pubyear-flatten', env: 'db', why: '出版年份扁平化(dry-run)', write: true },
  { name: 'refs-optimize-ops', env: 'db', why: '引用优化 A+C(dry-run)', write: true },
  { name: 'author-nation-ops', env: 'db', why: '作者国籍关系(dry-run)', write: true },
  { name: 'hk-identity-merge-ops', env: 'db', why: '香港身份合并(dry-run)', write: true },
  { name: 'dev-relations-demo', env: 'app', why: '演示夹具(会写库)', write: true },
  { name: 'refs-preview-html', env: 'db', why: '引用优化预览', needsArgs: '--out <html>' },
  { name: 'refs-once-only-leaves', env: 'db', why: '一次性标签清单', needsArgs: '--db <路径> --out <csv>' },
  { name: 'refs-optimize-readout', env: 'db', why: '引用优化读数', needsArgs: '--db <路径>' },

  // —— 已废弃(引用已删除的界面/接口,跑必失败) —— //
  { name: 'dev-types-accept', env: 'app', why: '已废弃:roles/tag_roles 已删', obsolete: true },
  { name: 'dev-types-accept-lib', env: 'app', why: '已废弃:同上', obsolete: true },
  { name: 'types-recon', env: 'db', why: '已废弃:角色/类型过渡期对账', obsolete: true },
];

/** 按名字查一条 */
export const byName = (n) => SCRIPTS.find((s) => s.name === n);
