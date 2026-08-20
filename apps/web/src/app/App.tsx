import {
  Bell,
  BookOpen,
  Boxes,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { useState } from "react";
import { AdaptiveWorkbench } from "../layout/AdaptiveWorkbench";

const domains = [
  { label: "收集", icon: Inbox },
  { label: "创作", icon: BookOpen },
  { label: "整理", icon: Search },
  { label: "协作", icon: Users },
  { label: "运营", icon: Settings },
];

export function App() {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activePane, setActivePane] = useState<"context" | "canvas">("canvas");

  const navigation = (
    <>
      <div className="brand-mark" aria-label="Nexus Notes">N</div>
      {domains.map(({ label, icon: Icon }, index) => (
        <button key={label} className={index === 1 ? "rail-item active" : "rail-item"} type="button">
          <Icon aria-hidden="true" size={19} />
          <span>{label}</span>
        </button>
      ))}
    </>
  );

  const contextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <button type="button" aria-label="新建笔记"><Sparkles size={17} /></button>
      </div>
      <label className="search-field"><Search size={15} /><input aria-label="搜索笔记" placeholder="搜索笔记" /></label>
      {["Public Beta 重写计划", "每日产品复盘", "数据库设计记录", "欢迎使用 Nexus Notes"].map((title, index) => (
        <button key={title} className={index === 0 ? "note-row selected" : "note-row"} type="button" onClick={() => setActivePane("canvas")}>
          <strong>{title}</strong><span>{index === 0 ? "刚刚" : `${index + 1} 天前`}</span>
          <p>保持专注、可靠并且随时可以恢复的知识工作台。</p>
        </button>
      ))}
    </div>
  );

  return (
    <AdaptiveWorkbench
      navigation={navigation}
      contextualList={contextualList}
      inspector={<div className="inspector-content"><small>页面信息</small><h3>Public Beta 重写计划</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
      inspectorOpen={inspectorOpen}
      activePane={activePane}
      onActivePaneChange={setActivePane}
      onInspectorOpen={() => setInspectorOpen(true)}
      onInspectorClose={() => setInspectorOpen(false)}
    >
      <article className="editor-document">
        <header className="editor-toolbar">
          <span className="saved-state"><span /> 已保存</span>
          <div>
            <button type="button" aria-label="通知"><Bell size={17} /></button>
            <button type="button" aria-label="打开检查器" onClick={() => setInspectorOpen(true)}><Boxes size={17} /></button>
          </div>
        </header>
        <div className="editor-copy">
          <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
          <h1>Public Beta 重写计划</h1>
          <p className="lead">一个稳定、响应迅速、离线可恢复的知识工作台。</p>
          <hr />
          <h2>自适应工作台</h2>
          <p>导航保持轻量，列表按需出现，主画布获得最多空间，检查器不再永久挤压编辑区域。</p>
          <div className="callout"><Sparkles size={18} /><p>视觉风格继续使用原有蓝色强调、玻璃层级和舒适圆角。</p></div>
        </div>
      </article>
    </AdaptiveWorkbench>
  );
}
