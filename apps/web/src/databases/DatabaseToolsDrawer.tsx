import type { DatabaseView } from "@nexus/contracts";

export function DatabaseToolsDrawer({
  open,
  views,
  activeViewId,
  onOpenChange,
  onViewChange,
}: {
  open: boolean;
  views: readonly DatabaseView[];
  activeViewId: string;
  onOpenChange(open: boolean): void;
  onViewChange(viewId: string): void;
}) {
  return (
    <>
      <button className="database-tools-trigger" type="button" aria-label="数据库工具" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        数据库工具
      </button>
      {open ? (
        <aside className="database-tools-drawer" role="dialog" aria-modal="false" aria-label="数据库工具">
          <header><strong>数据库工具</strong><button type="button" onClick={() => onOpenChange(false)}>关闭</button></header>
          <label>视图
            <select value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>
              {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          </label>
          <div className="database-tools-actions"><button type="button">导入 CSV</button><button type="button">导出 CSV</button></div>
        </aside>
      ) : null}
    </>
  );
}
