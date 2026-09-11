import type { ReactNode } from 'react';

export type ViewId = 'inbox' | 'diary' | 'todo' | 'media' | 'trip' | 'settings';

interface NavItem {
  id: ViewId;
  label: string;
}

const ITEMS: NavItem[] = [
  { id: 'inbox', label: '收件箱' },
  { id: 'diary', label: '日记' },
  { id: 'todo', label: '待办' },
  { id: 'media', label: '影视' },
  { id: 'trip', label: '旅游' },
  { id: 'settings', label: '设置' },
];

interface Props {
  current: ViewId;
  onSelect: (id: ViewId) => void;
}

/** 竖排导航:当前项高亮 */
export function Nav({ current, onSelect }: Props): ReactNode {
  return (
    <nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-gray-200 bg-gray-50 p-2">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={
            item.id === current
              ? 'rounded bg-blue-100 px-3 py-2 text-left text-sm font-medium text-blue-700'
              : 'rounded px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100'
          }
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
