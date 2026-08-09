"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsLeft,
  DatabaseZap,
  LayoutDashboard,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ApiHealth } from "@/types";

export type DashboardNavItem = {
  id: string;
  name: string;
  widgetCount: number;
};

type Props = {
  collapsed: boolean;
  health: ApiHealth;
  dashboards: DashboardNavItem[];
  activeDashboardId: string;
  busy: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
};

export function Sidebar({
  collapsed,
  health,
  dashboards,
  activeDashboardId,
  busy,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClear,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const editorRef = useRef<HTMLInputElement>(null);
  const statusCopy =
    health.status === "connected"
      ? "Connected"
      : health.status === "missing_key"
        ? "Missing key"
        : "Connection error";

  useEffect(() => {
    if (!creating && !editingId) return;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [creating, editingId]);

  function finishCreate() {
    const name = draftName.trim();
    if (!name) return;
    onCreate(name);
    setDraftName("");
    setCreating(false);
  }

  function startRename(item: DashboardNavItem) {
    setCreating(false);
    setEditingId(item.id);
    setDraftName(item.name);
  }

  function finishRename() {
    if (!editingId || !draftName.trim()) return;
    onRename(editingId, draftName);
    setEditingId(null);
    setDraftName("");
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark"><Sparkles size={20} /></div>
        {!collapsed ? (
          <div className="brand-copy"><strong>POLARIS</strong><span>DATA INTELLIGENCE</span></div>
        ) : null}
        <button className="icon-button sidebar-toggle" onClick={onToggle} aria-label="Toggle navigation">
          {collapsed ? <PanelLeftOpen size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav aria-label="Dashboard navigation">
        <div className="nav-heading">
          <p className="nav-label">{collapsed ? "" : "DASHBOARDS"}</p>
          {!collapsed ? (
            <button
              className="dashboard-add"
              onClick={() => {
                setEditingId(null);
                setDraftName("");
                setCreating(true);
              }}
              disabled={busy || dashboards.length >= 12}
              aria-label="Create dashboard"
              title="Create dashboard"
            ><Plus size={14} /></button>
          ) : null}
        </div>

        {!collapsed && creating ? (
          <div className="dashboard-name-editor">
            <input
              ref={editorRef}
              value={draftName}
              maxLength={40}
              placeholder="Dashboard name"
              aria-label="New dashboard name"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") finishCreate();
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <button onClick={finishCreate} disabled={!draftName.trim()} aria-label="Create"><Check size={13} /></button>
            <button onClick={() => setCreating(false)} aria-label="Cancel"><X size={13} /></button>
          </div>
        ) : null}

        <div className="dashboard-nav-list">
          {dashboards.map((item) => (
            <div className={`dashboard-nav-row ${item.id === activeDashboardId ? "active" : ""}`} key={item.id}>
              {editingId === item.id && !collapsed ? (
                <div className="dashboard-name-editor inline">
                  <input
                    ref={editorRef}
                    value={draftName}
                    maxLength={40}
                    aria-label="Dashboard name"
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") finishRename();
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button onClick={finishRename} disabled={!draftName.trim()} aria-label="Save name"><Check size={13} /></button>
                  <button onClick={() => setEditingId(null)} aria-label="Cancel"><X size={13} /></button>
                </div>
              ) : (
                <>
                  <button
                    className="nav-item dashboard-select"
                    onClick={() => onSelect(item.id)}
                    disabled={busy}
                    title={item.name}
                    aria-label={`Open ${item.name}`}
                  >
                    <LayoutDashboard size={17} />
                    {!collapsed ? <><span>{item.name}</span><small>{item.widgetCount}</small></> : null}
                  </button>
                  {!collapsed ? (
                    <div className="dashboard-row-actions">
                      <button onClick={() => startRename(item)} disabled={busy} aria-label={`Rename ${item.name}`} title="Rename"><Pencil size={12} /></button>
                      <button onClick={() => onDelete(item.id)} disabled={busy || dashboards.length === 1} aria-label={`Delete ${item.name}`} title="Delete"><Trash2 size={12} /></button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-actions">
        <button className="sidebar-action" onClick={onClear} disabled={busy} title="Clear active dashboard" aria-label="Clear active dashboard">
          <Trash2 size={16} />{!collapsed ? <span>Clear active dashboard</span> : null}
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
