import { useState } from 'react';
import type { ReactNode } from 'react';
import { DiaryView } from './DiaryView';
import { InboxView } from './InboxView';
import { Nav } from './Nav';
import { Placeholder } from './Placeholder';
import type { ViewId } from './Nav';

/** 主窗壳:左侧竖排导航 + 右侧内容区 switch */
export function App(): ReactNode {
  const [view, setView] = useState<ViewId>('inbox');

  return (
    <div className="flex h-screen bg-white text-gray-900">
      <Nav current={view} onSelect={setView} />
      {view === 'inbox' && <InboxView />}
      {view === 'diary' && <DiaryView />}
      {view === 'todo' && <Placeholder title="待办" hint="阶段 4 实现" />}
      {view === 'media' && <Placeholder title="影视" hint="阶段 5 实现" />}
      {view === 'trip' && <Placeholder title="旅游" hint="阶段 6 实现" />}
      {view === 'settings' && <Placeholder title="设置" hint="阶段 7 实现" />}
    </div>
  );
}
