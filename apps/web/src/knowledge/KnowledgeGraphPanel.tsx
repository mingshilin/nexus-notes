import { useEffect, useRef, useState } from "react";
import type { GraphResponse } from "@nexus/contracts";
import { KnowledgeClient } from "../data/knowledge-client";

type GraphClient = Pick<KnowledgeClient, "getGraph">;

export function KnowledgeGraphPanel({ client }: { client: GraphClient }) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const loadGraph = () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    void client.getGraph(undefined, controller.signal).then((nextGraph) => {
      if (!controller.signal.aborted) setGraph(nextGraph);
    }).catch(() => {
      if (!controller.signal.aborted) setError("知识图谱暂时无法加载，请重试。已有内容不会受到影响。");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  };

  useEffect(() => {
    loadGraph();
    return () => requestRef.current?.abort();
  }, [client]);

  const titleById = new Map((graph?.nodes ?? []).map((node) => [node.id, node.title || "未命名笔记"]));

  return (
    <section className="knowledge-graph" aria-labelledby="knowledge-graph-heading">
      <div className="knowledge-graph-heading"><div><small>LINKED KNOWLEDGE</small><h2 id="knowledge-graph-heading">知识图谱</h2></div><button type="button" disabled={loading} onClick={loadGraph}>{loading ? "加载中…" : "刷新图谱"}</button></div>
      {error ? <p className="knowledge-graph-error" role="alert">{error}</p> : null}
      {loading && !graph ? <p className="knowledge-graph-state" role="status">正在加载图谱…</p> : null}
      {!loading && graph && graph.nodes.length === 0 ? <p className="knowledge-graph-state">还没有可连接的笔记。</p> : null}
      {graph ? <>
        <p className="knowledge-graph-summary" aria-live="polite">{graph.nodes.length} 个节点 · {graph.edges.length} 条连接</p>
        <div className="knowledge-graph-nodes">{graph.nodes.map((node) => <article key={node.id} aria-label={node.title || "未命名笔记"} className={node.is_current ? "knowledge-graph-node current" : "knowledge-graph-node"}><strong>{node.title || "未命名笔记"}</strong><small>{node.is_current ? "当前笔记" : "关联笔记"}</small></article>)}</div>
        {graph.edges.length > 0 ? <ul className="knowledge-graph-edges" aria-label="知识连接">{graph.edges.map((edge) => <li key={`${edge.source}:${edge.target}`}>{titleById.get(edge.source) ?? edge.source} → {titleById.get(edge.target) ?? edge.target}</li>)}</ul> : null}
      </> : null}
    </section>
  );
}
