// 设置页「标签关系」分区的一行:实体树里显示引用(默认关)。
// 值、写库都在侧栏状态(use-sidebar-state 的 showRelations,持久化键 tag_tree_show_relations),
// 由 App 经 SettingsView 透传 —— 同一份状态,开关一拨侧栏树即时跟随(侧栏头部也有同一开关)。
import type { ReactNode } from 'react';
import { SettingsRow, Toggle } from './controls';

export interface TagTreeRelationRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function TagTreeRelationRow({ checked, onChange }: TagTreeRelationRowProps): ReactNode {
  return (
    <SettingsRow
      label="实体树里显示引用"
      hint="打开后,侧栏标签行末尾追加关系的值(悬停值看属性名);悬停标签名出档案卡片,一行一条关系"
    >
      <Toggle checked={checked} label="实体树里显示引用" onChange={onChange} />
    </SettingsRow>
  );
}
