export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  title: string;
  content: string;
}

export const noteTemplates: NoteTemplate[] = [
  {
    id: "blank",
    name: "空白笔记",
    description: "从空白页面开始",
    title: "",
    content: ``,
  },
  {
    id: "meeting",
    name: "会议记录",
    description: "议题、结论、行动项",
    title: "会议记录",
    content: `# 会议记录

## 背景


## 讨论要点

- 

## 结论

- 

## 行动项

- [ ] `,
  },
  {
    id: "project",
    name: "项目计划",
    description: "目标、范围、里程碑",
    title: "项目计划",
    content: `# 项目计划

## 目标


## 范围


## 里程碑

- [ ] M1
- [ ] M2
- [ ] M3

## 风险

- `,
  },
  {
    id: "reading",
    name: "阅读笔记",
    description: "摘要、摘录、个人理解",
    title: "阅读笔记",
    content: `# 阅读笔记

## 核心观点


## 重要摘录

> 

## 我的理解


## 后续行动

- [ ] `,
  },
  {
    id: "weekly",
    name: "周复盘",
    description: "进展、问题、下周计划",
    title: "周复盘",
    content: `# 周复盘

## 本周完成

- 

## 遇到的问题

- 

## 下周计划

- [ ] `,
  },
  {
    id: "accounting",
    name: "会计收支记录",
    description: "日期、分类、金额、备注",
    title: "会计收支记录",
    content: `# 会计收支记录

| 日期 | 分类 | 类型(收入/支出) | 金额 | 备注 |
| --- | --- | --- | ---: | --- |
| 2026-05-05 | 餐饮 | 支出 | 0 |  |
| 2026-05-05 | 工资 | 收入 | 0 |  |

## 本周待核对

- [ ] 核对现金流水
- [ ] 核对银行卡流水
- [ ] 生成月报`,
  },
  {
    id: "wishlist",
    name: "心愿单",
    description: "优先级、预算、状态、截止日期",
    title: "心愿单",
    content: `# 心愿单

| 愿望 | 优先级 | 预算 | 状态 | 截止日期 |
| --- | --- | ---: | --- | --- |
| 新显示器 | 高 | 0 | 计划中 | 2026-06-30 |
| 海边旅行 | 中 | 0 | 计划中 | 2026-09-30 |

## 行动清单

- [ ] 确认预算范围
- [ ] 比价与备选方案
- [ ] 设定最终购买/执行日期`,
  },
];
