"use client";

import {
  ChevronsLeft,
  DatabaseZap,
  LayoutDashboard,
  PanelLeftOpen,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ApiHealth } from "@/types";

type Props = {
  collapsed: boolean;
  health: ApiHealth;
  onToggle: () => void;
  onClear: () => void;
};

export function Sidebar({
  collapsed,
  health,
  onToggle,
  onClear,
}: Props) {
  const statusCopy =
    health.status === "connected"
      ? "Connected"
      : health.status === "missing_key"
        ? "Missing key"
        : "Connection error";

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark"><Sparkles size={20} /></div>
        {!collapsed ? (
          <div className="brand-copy"><strong>北极星</strong><span>POLARIS</span></div>
        ) : null}
        <button className="icon-button sidebar-toggle" onClick={onToggle} aria-label="Toggle navigation">
          {collapsed ? <PanelLeftOpen size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav aria-label="Dashboard navigation">
        <p className="nav-label">{collapsed ? "" : "WORKSPACE"}</p>
        <button className="nav-item active" title="My Dashboard" aria-label="My Dashboard">
          <LayoutDashboard size={17} />{!collapsed ? <span>My Dashboard</span> : null}
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-actions">
        <button className="sidebar-action" onClick={onClear} title="Clear dashboard" aria-label="Clear dashboard">
          <Trash2 size={16} />{!collapsed ? <span>Clear dashboard</span> : null}
        </button>
      </div>

      <div className={`api-status ${health.status}`} title={health.model ?? statusCopy}>
        <DatabaseZap size={15} />
        {!collapsed ? (
          <div><span>OpenAI API</span><strong>{statusCopy}</strong></div>
        ) : null}
        <i aria-hidden="true" />
      </div>
    </aside>
  );
}
