"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { Background, Handle, Position, ReactFlow, type Edge as RFEdge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import type { BlastResult } from "@/lib/blastRadius";
import type { Account, AccountAlert, Edge, Entity, EventRecord, PriorityTier } from "@/lib/types";
import { originKind, TIER_COLOR, tierLabel } from "./ui";
import { DIRECT_LABEL } from "@/lib/blastRadius";

type NodeData = {
  title: string;
  sub?: string;
  ring: string;
  synthetic?: boolean;
  note?: string;
  visible: boolean;
  faded: boolean;
  kind: "event" | "facility" | "company" | "account";
};

const NODE_H = 76;
const NODE_H_TALL = 104;
const NODE_GAP = 16;

function ArgusNode({ data }: NodeProps<RFNode<NodeData>>) {
  return (
    <div
      className="w-[220px] overflow-hidden border bg-panel px-3 py-2 transition-opacity duration-500"
      style={{
        height: data.note ? NODE_H_TALL : NODE_H,
        borderColor: data.ring,
        boxShadow: data.ring !== "#232a36" ? `0 0 0 1px ${data.ring}55` : undefined,
        opacity: data.visible ? (data.faded ? 0.28 : 1) : 0,
        cursor: data.kind === "account" ? "pointer" : "default",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="font-mono text-[10px] uppercase tracking-widest text-dim">
        {data.synthetic ? "SYNTHETIC · " : ""}
        {data.kind}
      </div>
      <div className="truncate text-[15px] font-medium leading-tight text-ink">{data.title}</div>
      {data.sub && <div className="truncate font-mono text-[11px] text-dim">{data.sub}</div>}
      {data.note && <div className="font-mono text-[10px] leading-tight text-monitor">{data.note}</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { argus: ArgusNode };
const RANK: Record<PriorityTier, number> = { "REVIEW NOW": 2, MONITOR: 1, "NO ACTION": 0 };
export const EVENT_NODE = "__event";

export default function BlastGraph({
  event,
  result,
  entities,
  accounts,
  edges,
  selected,
  demo,
  onSelect,
}: {
  event: EventRecord;
  result: BlastResult;
  entities: Entity[];
  accounts: Account[];
  edges: Edge[];
  selected: AccountAlert | null;
  demo: { seq: string[]; step: number } | null;
  onSelect: (accountId: string) => void;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= 3 ? s : s + 1)), 700);
    return () => clearInterval(t);
  }, [event.id]);

  const { nodes, rfEdges } = useMemo(() => {
    const affected = Object.keys(result.affected);
    const accountIds = new Set(accounts.map((a) => a.id));
    const col = new Map<string, number>([[EVENT_NODE, 0]]);
    const downstream = new Set(edges.filter((e) => result.reachedEdges.includes(e.id) && affected.includes(e.from)).map((e) => e.to));
    affected.forEach((id) => col.set(id, downstream.has(id) ? 2 : 1));
    result.reachedNodes.forEach((id) => {
      if (!col.has(id)) col.set(id, accountIds.has(id) ? 3 : 2);
    });
    accounts.forEach((a) => col.set(a.id, 3));

    const nodeTier = new Map<string, PriorityTier>();
    for (const al of result.alerts) {
      for (const n of al.path.slice(0, -1)) {
        const cur = nodeTier.get(n);
        if (!cur || RANK[al.tier] > RANK[cur]) nodeTier.set(n, al.tier);
      }
    }
    const alertById = new Map(result.alerts.map((a) => [a.account.id, a]));
    const entById = new Map(entities.map((e) => [e.id, e]));
    const hl = selected ? new Set([EVENT_NODE, ...selected.path, selected.account.id]) : null;

    const columns: string[][] = [[], [], [], []];
    col.forEach((c, id) => columns[c].push(id));
    columns[3].sort((a, b) => RANK[alertById.get(b)!.tier] - RANK[alertById.get(a)!.tier]);

    const nodes: RFNode<NodeData>[] = [];
    const heightOf = (id: string) => (accountIds.has(id) && alertById.get(id)?.direct ? NODE_H_TALL : NODE_H);
    columns.forEach((ids, c) => {
      const total = ids.reduce((s, id) => s + heightOf(id), 0) + NODE_GAP * Math.max(0, ids.length - 1);
      let cursor = -total / 2;
      ids.forEach((id) => {
        const y = cursor;
        cursor += heightOf(id) + NODE_GAP;
        let data: NodeData;
        if (id === EVENT_NODE) {
          data = {
            title: event.title,
            sub: `M${event.magnitude ?? "UNKNOWN"} · USGS`,
            ring: "#5aa9e6",
            kind: "event",
            visible: true,
            faded: false,
          };
        } else if (accountIds.has(id)) {
          const al = alertById.get(id)!;
          data = {
            title: al.account.name,
            sub: al.recovery ? `${tierLabel(al)} · ${al.recovery.status === "RECOVERED" ? "recovered" : "recovering"} (${al.recovery.claimId})` : al.tier,
            note: al.direct ? DIRECT_LABEL : undefined,
            ring: TIER_COLOR[al.tier],
            kind: "account",
            synthetic: true,
            visible: step >= 3,
            faded: false,
          };
        } else {
          const e = entById.get(id);
          const t = nodeTier.get(id);
          data = {
            title: e?.short_name ?? e?.name ?? id,
            sub: result.affected[id]
              ? `${result.plantStates[id] && result.plantStates[id].status !== "DISRUPTED" ? result.plantStates[id].status : "affected"} · ${result.affected[id].length} claim(s)`
              : e?.type,
            ring: t ? TIER_COLOR[t] : "#232a36",
            kind: e?.type ?? "company",
            visible: step >= c,
            faded: false,
          };
        }
        data.faded = !!hl && !hl.has(id);
        if (demo) {
          const idx = demo.seq.indexOf(id);
          data.visible = idx >= 0 && idx <= demo.step;
          data.faded = false;
          if (data.kind === "account" && demo.step < demo.seq.length) {
            data.ring = "#5aa9e6";
            data.sub = "SYNTHETIC insured account";
          }
        }
        nodes.push({ id, type: "argus", position: { x: c * 290, y }, data, draggable: false });
      });
    });

    const visibleCol = (id: string) => (col.get(id) ?? 99) <= step;
    const hlEdges = new Set(selected?.pathEdgeIds ?? []);
    const demoPos = (id: string) => (demo ? demo.seq.indexOf(id) : -1);
    const demoEdgeVisible = (from: string, to: string) => {
      const a = demoPos(from);
      return a >= 0 && demoPos(to) === a + 1 && a + 1 <= demo!.step;
    };
    const rfEdges: RFEdge[] = [];
    affected.forEach((f) => {
      const on = demo ? demoEdgeVisible(EVENT_NODE, f) : !!selected && selected.path[0] === f;
      rfEdges.push({
        id: `impact-${f}`,
        source: EVENT_NODE,
        target: f,
        hidden: demo ? !on : !visibleCol(f),
        style: { stroke: "#5aa9e6", strokeWidth: on ? 2.5 : 1.2, opacity: hl && !on ? 0.2 : 0.9 },
      });
    });
    for (const e of edges) {
      const direct = e.relation === "located_in_region" && e.from === `region:${event.region}`;
      if (!direct && !result.reachedEdges.includes(e.id)) continue;
      const source = direct ? EVENT_NODE : e.from;
      const on = demo ? demoEdgeVisible(source, e.to) : hlEdges.has(e.id);
      const base =
        e.origin === "PUBLIC_VERIFIED"
          ? { stroke: "#c3cad5" }
          : e.origin === "INFERRED"
            ? { stroke: "#8a94a5", strokeDasharray: "5 4" }
            : { stroke: "#4a5363" };
      rfEdges.push({
        id: e.id,
        source,
        target: e.to,
        hidden: demo ? !on : !(visibleCol(source) && visibleCol(e.to)),
        label: on ? `${e.id} · ${originKind(e.origin)}` : e.origin === "SYNTHETIC" ? "SYNTHETIC" : undefined,
        labelStyle: { fill: on ? "#d6dbe3" : "#7d8797", fontSize: 9, fontFamily: "monospace" },
        labelBgStyle: { fill: "#11151c" },
        style: {
          ...base,
          ...(on ? { stroke: "#5aa9e6" } : {}),
          strokeWidth: on ? 2.5 : 1.2,
          opacity: hl && !on ? 0.15 : 1,
        },
      });
    }
    return { nodes, rfEdges };
  }, [event, result, entities, accounts, edges, selected, step, demo]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: { top: "64px", bottom: "16px", left: "16px", right: "16px" } }}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => {
        if (n.data.kind === "account") onSelect(n.id);
      }}
      colorMode="dark"
      style={{ background: "transparent" }}
    >
      <Background color="#1a202a" gap={24} />
    </ReactFlow>
  );
}
