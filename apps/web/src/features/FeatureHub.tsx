import { Bell, Bot, Database, Library, NotebookPen, UserRound, UsersRound } from "lucide-react";

export type FeatureId = "notes" | "databases" | "knowledge" | "reminders" | "collaboration" | "ai" | "account";

export interface FeatureHubProps {
  onNavigate(id: FeatureId): void;
  availability?: Partial<Record<FeatureId, boolean>>;
}

type Feature = {
  id: FeatureId;
  label: string;
  description: string;
  icon: typeof NotebookPen;
};

const features: Feature[] = [
  { id: "notes", label: "笔记", description: "记录、编辑和恢复你的想法。", icon: NotebookPen },
  { id: "databases", label: "数据库", description: "用表格、看板和日历组织结构化信息。", icon: Database },
  { id: "knowledge", label: "知识整理", description: "处理附件、OCR 和知识诊断。", icon: Library },
  { id: "reminders", label: "提醒", description: "集中查看需要跟进的事项。", icon: Bell },
  { id: "collaboration", label: "协作", description: "邀请成员、评论并共享内容。", icon: UsersRound },
  { id: "ai", label: "AI 助手", description: "在工作区内与 AI 对话。", icon: Bot },
  { id: "account", label: "个人中心", description: "修改资料、密码、安全和隐私设置。", icon: UserRound },
];

export function FeatureHub({ onNavigate, availability = {} }: FeatureHubProps) {
  return (
    <section className="feature-hub" aria-labelledby="feature-hub-heading">
      <div className="feature-hub-heading">
        <div>
          <p className="eyebrow">工作区</p>
          <h2 id="feature-hub-heading">功能地图</h2>
        </div>
        <p>从这里进入 Nexus Notes 的各个工作区域。</p>
      </div>
      <div className="feature-hub-grid">
        {features.map(({ id, label, description, icon: Icon }) => {
          const available = availability[id] ?? id !== "reminders";
          const status = available ? "已可用" : id === "collaboration" ? "当前不可用" : "即将开放";
          return (
            <button
              key={id}
              type="button"
              className={available ? "feature-hub-item" : "feature-hub-item unavailable"}
              disabled={!available}
              aria-label={`${available ? `打开${label}` : `${label}，${status}`}`}
              onClick={() => { if (available) onNavigate(id); }}
            >
              <span className="feature-hub-icon"><Icon aria-hidden="true" size={18} /></span>
              <span className="feature-hub-copy"><strong>{label}</strong><small>{description}</small></span>
              <span className="feature-hub-status">{status}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
