/**
 * 接受 `#` 行时的路径复核(复审 m1;自 use-app-palette 抽出以留行数余量)。
 *
 * 换新窗口(~12ms:数据版本已 +1、新数据还在飞)里旧列表仍可点/回车,若那条标签刚被改名或删除,
 * 直接 `toggleTag(旧路径)` 会落一个空筛选(界面像"筛了个不存在的标签")。
 * 复核走候选池:版本已变时它返回的就是**新数据**(在飞的那次取回),所以能真判新旧。
 * 复核失败(一次 IPC 抖动)不阻断 —— 退回原行为,不能因为复核点不动。
 */
import type { TagCandidates } from './tag-candidates';

export interface TagAcceptDeps {
  /** 标签候选池(缓存键 = 数据版本) */
  pool: TagCandidates;
  /** 现读数据版本(注册表/接受都从同一处取) */
  getVersion: () => number;
  toggleTag: (path: string) => void;
  /** 复核不通过:中文原因交主窗错误条,不静默 */
  setError: (message: string) => void;
}

export function acceptTagPath(path: string, deps: TagAcceptDeps): void {
  void (async () => {
    try {
      const rows = await deps.pool.current(deps.getVersion());
      if (rows.some((tag) => tag.path === path)) deps.toggleTag(path);
      else deps.setError(`标签「${path}」已变更,请重新选择`);
    } catch {
      deps.toggleTag(path);
    }
  })();
}
