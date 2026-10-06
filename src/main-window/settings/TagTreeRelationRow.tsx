// 设置页「标签关系」分区的一行:标签树里显示关系(默认关)。
// 值、写库都在侧栏状态(use-sidebar-state 的 showRelations,持久化键 tag_tree_show_relations;
// 旧键 tag_tree_show_carry 仍回读),由 App 经 SettingsView 透传 —— 同一份状态,开关一拨侧栏树即时跟随。
import type { ReactNode } from 'react';
import { SettingsRow, Toggle } from './controls';

export interface TagTreeRelationRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function TagTreeRelationRow({ checked, onChange }: TagTreeRelationRowProps): ReactNode {
  return (
    <SettingsRow
      label="标签树里显示关系"
      hint="打开后,侧栏标签行末尾追加关系的值(悬停值看属性名);悬停标签名出档案卡片,一行一条关系"
    >
      <Toggle checked={checked} label="标签树里显示关系" onChange={onChange} />
    </SettingsRow>
  );
}
