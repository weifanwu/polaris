"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Activity, ArrowUp, Bot, ChevronDown, ChevronRight, FileSpreadsheet, PanelRightClose, PanelRightOpen, Paperclip, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { listWorksheetNames, readWorksheet } from "@/lib/data-connectors/xlsx";
import { MAX_USER_DATA_CHARS, MAX_USER_FILE_BYTES, userDatasetSizeLabel, type UserDataset } from "@/lib/user-dataset";
import type { ChatMessage, RecoveryProposal } from "@/types";

export const examplePrompts = [
  "Compare Canada and Ontario monthly unemployment over the last 10 years",
  "Compare Toronto and Ottawa monthly new-housing price changes",
  "Analyze the last decade of GDP growth across Canada, the U.S., and China",
];

const CHAT_PANEL_STORAGE_KEY = "polaris-ui:chat-panel-width";
const DEFAULT_CHAT_PANEL_WIDTH = 390;
const MIN_CHAT_PANEL_WIDTH = 320;
const MAX_CHAT_PANEL_WIDTH = 720;

function maximumChatPanelWidth() {
  if (typeof window === "undefined") return MAX_CHAT_PANEL_WIDTH;
  return Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, window.innerWidth - 620));
}

function clampChatPanelWidth(width: number) {
  return Math.min(maximumChatPanelWidth(), Math.max(MIN_CHAT_PANEL_WIDTH, Math.round(width)));
}

type Props = {
  collapsed: boolean;
  query: string;
  messages: ChatMessage[];
  loadingStage: "working" | "analyzing" | null;
  userDataset: UserDataset | null;
  dashboardWidgetCount: number;
  dashboardName: string;
  recoveryProposal: RecoveryProposal | null;
  onToggle: () => void;
  onClear: () => void;
  onQueryChange: (query: string) => void;
  onDatasetChange: (dataset: UserDataset | null) => void;
  onSubmit: () => void;
  onApproveRecovery: () => void;
  onDismissRecovery: () => void;
  onFocusWidget: (id: string) => void;
};

export function ChatPanel({
  collapsed,
  query,
  messages,
  loadingStage,
  userDataset,
  dashboardWidgetCount,
  dashboardName,
  recoveryProposal,
  onToggle,
  onClear,
  onQueryChange,
  onDatasetChange,
  onSubmit,
  onApproveRecovery,
  onDismissRecovery,
  onFocusWidget,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dataTrayOpen, setDataTrayOpen] = useState(false);
  const [dataError, setDataError] = useState("");
  const [panelWidth, setPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(CHAT_PANEL_STORAGE_KEY));
    const restoreFrame = window.requestAnimationFrame(() => {
      if (Number.isFinite(stored) && stored > 0) setPanelWidth(clampChatPanelWidth(stored));
    });

    const clampOnViewportChange = () => setPanelWidth((current) => clampChatPanelWidth(current));
    window.addEventListener("resize", clampOnViewportChange);
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.removeEventListener("resize", clampOnViewportChange);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CHAT_PANEL_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 780) return;
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
    event.preventDefault();
  }

  function continueResize(event: PointerEvent<HTMLDivElement>) {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setPanelWidth(clampChatPanelWidth(current.startWidth + current.startX - event.clientX));
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    setResizing(false);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = panelWidth + 24;
    if (event.key === "ArrowRight") next = panelWidth - 24;
    if (event.key === "Home") next = MIN_CHAT_PANEL_WIDTH;
    if (event.key === "End") next = maximumChatPanelWidth();
    if (next === null) return;
    event.preventDefault();
    setPanelWidth(clampChatPanelWidth(next));
  }

  async function attachFile(file: File) {
    setDataError("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "text";
      let content = "";
      let format: UserDataset["format"] = "text";

      if (extension === "pdf") {
        if (file.size > MAX_USER_FILE_BYTES) {
          throw new Error("PDF files must be 8 MB or smaller to keep analysis time and token use bounded.");
        }
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode this PDF."));
          reader.onerror = () => reject(reader.error ?? new Error("Could not read this PDF."));
          reader.readAsDataURL(file);
        });
        onDatasetChange({ name: file.name, format: "pdf", content: "", fileData, byteSize: file.size });
        setDataTrayOpen(true);
        return;
      } else if (extension === "xlsx") {
        const workbook = await file.arrayBuffer();
        const sheetName = listWorksheetNames(workbook)[0];
        if (!sheetName) throw new Error("The workbook does not contain a readable worksheet.");
        const rows = readWorksheet(workbook, sheetName);
        const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.cells))))
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
        content = rows.map((row) => columns.map((column) =>
          (row.cells[column] ?? "").replace(/[\t\r\n]+/g, " "),
        ).join("\t")).join("\n");
        format = "xlsx";
      } else {
        content = await file.text();
        format = extension === "csv" || extension === "tsv" || extension === "json"
          ? extension
          : "text";
      }

      const truncated = content.length > MAX_USER_DATA_CHARS;
      const bounded = content.slice(0, MAX_USER_DATA_CHARS).trim();
      if (!bounded) throw new Error("The selected file is empty.");
      onDatasetChange({ name: file.name, format, content: bounded, truncated });
      setDataTrayOpen(true);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: messages.length > 1 ? "smooth" : "auto",
    });
  }, [loadingStage, messages, recoveryProposal]);

  if (collapsed) {
    return (
      <aside className="chat-collapsed">
        <button onClick={onToggle} aria-label="Open chat panel"><PanelRightOpen size={18} /></button>
        <span>ASK POLARIS</span>
      </aside>
    );
  }

  return (
    <aside
      className={`chat-panel${resizing ? " resizing" : ""}`}
      style={{ "--chat-panel-width": `${panelWidth}px` } as CSSProperties}
    >
      <div
        className="chat-resize-handle"
        role="slider"
        aria-label="Resize chat panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_CHAT_PANEL_WIDTH}
        aria-valuemax={maximumChatPanelWidth()}
        aria-valuenow={panelWidth}
        aria-valuetext={`${panelWidth} pixels wide`}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={() => setPanelWidth(clampChatPanelWidth(DEFAULT_CHAT_PANEL_WIDTH))}
      ><span /></div>
      <header className="chat-header">
        <div><span>DATA AGENT</span><h2>Ask Polaris</h2></div>
        <div className="chat-header-actions">
          <button
            className="icon-button danger"
            onClick={onClear}
            disabled={(messages.length === 0 && !recoveryProposal) || Boolean(loadingStage)}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 size={16} />
          </button>
          <button className="icon-button" onClick={onToggle} aria-label="Collapse chat panel"><PanelRightClose size={17} /></button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="agent-avatar"><Sparkles size={18} /></div>
            <h3>What would you like to understand?</h3>
            <p>I can research live sources, or analyze a dataset you paste or upload.</p>
            <div className="example-list">
              {examplePrompts.map((prompt) => (
                <button key={prompt} onClick={() => onQueryChange(prompt)}>
                  <span>{prompt}</span><ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role} ${message.tone ?? ""}`}>
                <div className="message-avatar">{message.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}</div>
                <div>
                  <span>{message.role === "user" ? "YOU" : "POLARIS"}</span>
                  <p>{message.content}</p>
                  {message.usage ? (
                    <small className="message-usage">
                      {message.usage.inputTokens.toLocaleString()} input
                      {message.usage.cachedInputTokens > 0
                        ? ` · ${message.usage.cachedInputTokens.toLocaleString()} cached`
                        : ""}
                      {` · ${message.usage.modelCalls} call${message.usage.modelCalls === 1 ? "" : "s"}`}
                      {` · ${message.usage.webSearchCalls} search${message.usage.webSearchCalls === 1 ? "" : "es"}`}
                    </small>
                  ) : null}
                  {message.trace ? <TracePanel trace={message.trace} /> : null}
                  {message.widgetId ? (
                    <button className="focus-widget" onClick={() => onFocusWidget(message.widgetId!)}>View widget <ChevronRight size={12} /></button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {recoveryProposal && !loadingStage ? (
          <section className="recovery-proposal" aria-label="Recommended chart alternative">
            <div className="recovery-proposal-kicker"><Sparkles size={13} /><span>READY ALTERNATIVE</span></div>
            <h3>{recoveryProposal.title}</h3>
            <p>{recoveryProposal.description}</p>
            <div className="recovery-proposal-meta">
              <span>{recoveryProposal.widget.rows.length} cached rows</span>
              <span>{recoveryProposal.widget.dataQuality?.frequency ?? "verified"}</span>
              <span>0 new searches after approval</span>
            </div>
            <div className="recovery-proposal-actions">
              <button className="primary" onClick={onApproveRecovery}>{recoveryProposal.approvalLabel}</button>
              <button onClick={onDismissRecovery}>Dismiss</button>
            </div>
          </section>
        ) : null}

        {loadingStage ? (
          <div className="agent-progress">
            <div className="progress-orbit"><Activity size={15} /></div>
            <div>
              <strong>{loadingStage === "analyzing" ? "Analyzing supplied data…" : "Agent is working…"}</strong>
              <span>{loadingStage === "analyzing"
                ? "Reading the attached dataset and preparing a reproducible result"
                : "The completed run trace will show the actual route, searches, and transformations"}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="chat-composer">
        {dataTrayOpen ? (
          <div className="data-tray">
            <div className="data-tray-header">
              <div><FileSpreadsheet size={14} /><strong>Analyze your data</strong></div>
              <button className="icon-button" onClick={() => setDataTrayOpen(false)} aria-label="Close data input"><X size={14} /></button>
            </div>
            {userDataset && userDataset.name !== "Pasted data" ? (
              <div className="dataset-chip">
                <FileSpreadsheet size={14} />
                <div><strong>{userDataset.name}</strong><span>{userDatasetSizeLabel(userDataset)}{userDataset.truncated ? " · trimmed" : ""}</span></div>
                <button onClick={() => onDatasetChange(null)} aria-label="Remove attached dataset"><X size={13} /></button>
              </div>
            ) : (
              <textarea
                className="data-paste"
                value={userDataset?.name === "Pasted data" ? userDataset.content : ""}
                onChange={(event) => {
                  const content = event.target.value.slice(0, MAX_USER_DATA_CHARS);
                  onDatasetChange(content.trim() ? { name: "Pasted data", format: "text", content } : null);
                }}
                rows={5}
                placeholder="Paste CSV, spreadsheet cells, JSON, or a small table here…"
                aria-label="Paste data for analysis"
                disabled={Boolean(loadingStage)}
              />
            )}
            <div className="data-tray-footer">
              <span>CSV · TSV · JSON · XLSX · PDF · TXT</span>
              <button onClick={() => fileRef.current?.click()} disabled={Boolean(loadingStage)}><Paperclip size={13} /> Choose file</button>
            </div>
            {dataError ? <p className="data-error">{dataError}</p> : null}
          </div>
        ) : null}
        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept=".csv,.tsv,.json,.xlsx,.pdf,.txt,text/csv,text/tab-separated-values,application/json,application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void attachFile(file);
          }}
        />
        <div className="composer-box">
          <textarea
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={3}
            maxLength={500}
            disabled={Boolean(loadingStage)}
            placeholder={userDataset ? "What should Polaris analyze or visualize?" : "Ask for live data or attach your own…"}
            aria-label="Ask Polaris for data"
          />
          <div>
            <span>↵ send · ⇧↵ newline</span>
            <div className="composer-actions">
              <button
                className={`attach-button ${userDataset ? "active" : ""}`}
                onClick={() => setDataTrayOpen((value) => !value)}
                disabled={Boolean(loadingStage)}
                aria-label="Attach or paste data"
                title="Analyze your own data"
              ><Paperclip size={15} /></button>
              <button onClick={onSubmit} disabled={(!query.trim() && !userDataset) || Boolean(loadingStage)} aria-label="Send question"><ArrowUp size={17} /></button>
            </div>
          </div>
        </div>
        <p>
          {userDataset
            ? "Your attached data is used for this analysis only."
            : dashboardWidgetCount > 0
              ? `${dashboardWidgetCount} widget${dashboardWidgetCount === 1 ? "" : "s"} from “${dashboardName}” included as compact metadata context · no full tables sent`
              : "Polaris can make mistakes. Verify important data at the source."}
        </p>
      </div>
    </aside>
  );
}

function TracePanel({ trace }: { trace: NonNullable<ChatMessage["trace"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`trace-panel ${open ? "open" : ""}`}>
      <button className="trace-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Activity size={12} />
        <span>RUN TRACE</span>
        <small>{trace.events.length} steps · {trace.mode.replace("_", " ")}</small>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="trace-body">
          <p>{trace.summary}</p>
          <ol>
            {trace.events.map((event) => (
              <li key={event.id} className={event.status}>
                <i />
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.detail}</span>
                  {event.durationMs !== undefined ? <small>{event.durationMs.toLocaleString()} ms</small> : null}
                </div>
              </li>
            ))}
          </ol>
          <footer>Operational plan and tool activity — not private model reasoning.</footer>
        </div>
      ) : null}
    </div>
  );
}
