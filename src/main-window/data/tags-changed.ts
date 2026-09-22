/**
 * 标签新鲜度的唯一出口(T6 修复轮 I2):任何"标签数据可能变了"的地方都调 notifyTagsChanged(),
 * 主窗订阅一次(onTagsChanged)执行真正的重载(loadTags -> tagRows + tagsVersion)。
 *
 * 为什么要出口而不是各处自己调 loadTags:写库路径散在编辑面板、卸载兜底、输入栏事件里,
 * 其中卸载兜底(use-save-on-unmount)在 cleanup 里跑,没有任何回调通道可以把 reload 传下去 ——
 * 靠"改标签的人都记得递增 tagsVersion"必然漏(复审实测两条绕过)。出口做成模块级订阅而不是
 * 逐层传 prop,就是为了让这类无通道的调用点也能到达出口。
 *
 * 合并:一次保存里"写库出口"与"既有 reload"都会通知(两者之间还隔着 `await` 的续体),
 * 输入栏保存则是"事件通知 + 回首页重查里的通知"。所以合并窗口取**一整轮事件循环**
 * (宏任务)而不是微任务:微任务只能合并同步连发的通知,上面两种都会漏成两次全树 list_tags。
 * 代价只是重载晚一个宏任务(0ms 级),不可见。
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let pending = false;

/** 声明"标签数据可能变了":同一轮事件循环内多次调用合并为一次通知 */
export function notifyTagsChanged(): void {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false; // 先复位再分发:listener 里再通知也能排到下一轮,不会被吞
    for (const listener of [...listeners]) listener();
  }, 0);
}

/** 订阅重载;返回退订函数(主窗卸载时调用) */
export function onTagsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
