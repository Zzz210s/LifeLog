// 设置视图:整页替换信息流(信息流仍挂载在另一分支,返回时状态与滚动位置不丢)。
import type { ReactNode } from 'react';
import { GeneralSection } from './settings/GeneralSection';
import { InputBarSection } from './settings/InputBarSection';
import { StartupSection } from './settings/StartupSection';

export function SettingsView(): ReactNode {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5">
        <h1 className="text-base font-semibold text-gray-900">设置</h1>
        <InputBarSection />
        <StartupSection />
        <GeneralSection />
      </div>
    </div>
  );
}
