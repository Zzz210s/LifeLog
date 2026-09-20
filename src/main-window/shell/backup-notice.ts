/**
 * 启动期「迁移前自动备份失败」的错误条文案(纯函数)。
 * 备份失败不阻断升级:文案必须同时说清「失败了什么」「应用还能用」「要留意什么」。
 */
export function backupWarningText(reason: string): string {
  return `自动备份失败:${reason},已继续升级,请留意磁盘空间`;
}
