// 初始化时落进库里的东西：四个 Bases 视图 + LifeLog 页面。
// 模板必须写在代码里（插件发布只带 main.js / manifest / styles，不带 templates 目录）。
export const BASE_TEMPLATES: Record<string, string> = {
  '信息流.base': `filters:
  and:
    - file.inFolder("{{ROOT}}/笔记")
views:
  - type: table
    name: 信息流
    order:
      - lifelog_created
      - file.name
    sort:
      - property: lifelog_created
        direction: DESC
    limit: 200
`,
  '标签索引.base': `filters:
  and:
    - file.inFolder("{{ROOT}}/实体")
views:
  - type: table
    name: 按父级分组
    order:
      - file.name
    groupBy:
      property: lifelog_parent
      direction: ASC
  - type: table
    name: 平铺
    order:
      - file.name
      - lifelog_parent
    sort:
      - property: lifelog_parent
        direction: ASC
`,
  '关系表.base': `filters:
  and:
    - file.inFolder("{{ROOT}}/笔记")
    - file.hasProperty("lifelog_relations")
views:
  - type: table
    name: 命名关系
    order:
      - file.name
      - lifelog_relations
      - lifelog_created
    sort:
      - property: lifelog_created
        direction: DESC
`,
  '时间轴.base': `filters:
  and:
    - file.inFolder("{{ROOT}}/笔记")
views:
  - type: table
    name: 按天分组
    order:
      - file.name
    groupBy:
      property: lifelog_created
      direction: DESC
`,
};

export function baseFiles(root: string): { path: string; content: string }[] {
  return Object.entries(BASE_TEMPLATES).map(([name, yaml]) => ({
    path: `${root}/${name}`,
    content: yaml.replace(/\{\{ROOT\}\}/g, root),
  }));
}
