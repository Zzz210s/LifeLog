// 「角色建议」面板的一行(纯展示 + 回调):勾选、把建议角色改成别的已登记角色、忽略。
// 从 RoleSuggestionsSection 拆出,让面板本体留在 200 行内;状态全由调用方持有。
import type { ReactNode } from 'react';
import type { RoleRef } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';
import { SelectInput } from './controls';
import { type RoleSuggestion } from './role-suggestions';

export interface RoleSuggestionRowProps {
  row: RoleSuggestion;
  /** 已登记角色(供「改成别的角色」下拉) */
  roles: readonly RoleRef[];
  checked: boolean;
  /** 当前生效的角色标签 id(可能是改过的) */
  roleId: number;
  onToggle: () => void;
  onRole: (roleId: number) => void;
  onIgnore: () => void;
}

export function RoleSuggestionRow({
  row,
  roles,
  checked,
  roleId,
  onToggle,
  onRole,
  onIgnore,
}: RoleSuggestionRowProps): ReactNode {
  const options = [{ value: String(row.roleTagId), label: row.roleName }];
  for (const r of roles) if (r.tagId !== row.roleTagId) options.push({ value: String(r.tagId), label: r.name });

  return (
    <div
      data-role-row={row.tagPath}
      className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0"
    >
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input type="checkbox" checked={checked} aria-label={'选中 ' + row.tagPath} onChange={onToggle} />
        <span className="truncate text-ui text-text" title={row.tagPath}>
          {row.tagPath}
        </span>
      </label>
      <SelectInput
        value={String(roleId)}
        label={'角色 ' + row.tagPath}
        options={options}
        onChange={(v) => onRole(Number(v))}
      />
      <span className="text-label text-muted">{row.basis}</span>
      <button type="button" aria-label={'忽略 ' + row.tagPath} className={BTN_TEXT} onClick={onIgnore}>
        忽略
      </button>
    </div>
  );
}
