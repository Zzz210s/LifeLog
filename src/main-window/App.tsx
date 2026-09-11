import type { ReactNode } from 'react';
import { InboxView } from './InboxView';

/** 主窗壳(临时):v2 时间流在 Task 3 重写,当前仅全幅渲染收件箱占位 */
export function App(): ReactNode {
  return (
    <div className="flex h-screen bg-white text-gray-900">
      <InboxView />
    </div>
  );
}
