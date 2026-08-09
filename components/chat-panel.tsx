"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronRight, FileSpreadsheet, PanelRightClose, PanelRightOpen, Paperclip, Search, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { listWorksheetNames, readWorksheet } from "@/lib/data-connectors/xlsx";
import { MAX_USER_DATA_CHARS, type UserDataset } from "@/lib/user-dataset";
import type { ChatMessage } from "@/types";

export const examplePrompts = [
  "比较过去两年加拿大和安大略省每月失业率",
  "过去两年多伦多和渥太华新房价格指数每月环比",
  "比较过去10年加拿大、美国和中国的GDP",
];

type Props = {
  collapsed: boolean;
  query: string;
  messages: ChatMessage[];
  loadingStage: "searching" | "structuring" | null;
  userDataset: UserDataset | null;
  onToggle: () => void;
  onClear: () => void;
  onQueryChange: (query: string) => void;
  onDatasetChange: (dataset: UserDataset | null) => void;
  onSubmit: () => void;
  onFocusWidget: (id: string) => void;
};

export function ChatPanel({
  collapsed,
  query,
  messages,
  loadingStage,
  userDataset,
  onToggle,
  onClear,
  onQueryChange,
  onDatasetChange,
  onSubmit,
  onFocusWidget,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dataTrayOpen, setDataTrayOpen] = useState(false);
  const [dataError, setDataError] = useState("");

  async function attachFile(file: File) {
    setDataError("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "text";
      let content = "";
      let format: UserDataset["format"] = "text";

      if (extension === "xlsx") {
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
  }, [loadingStage, messages]);

  if (collapsed) {
    return (
      <aside className="chat-collapsed">
        <button onClick={onToggle} aria-label="Open chat panel"><PanelRightOpen size={18} /></button>
        <span>ASK POLARIS</span>
      </aside>
    );
  }

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <div><span>DATA AGENT</span><h2>Ask Polaris</h2></div>
        <div className="chat-header-actions">
          <button
            className="icon-button danger"
            onClick={onClear}
            disabled={messages.length === 0 || Boolean(loadingStage)}
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
                  {message.widgetId ? (
                    <button className="focus-widget" onClick={() => onFocusWidget(message.widgetId!)}>View widget <ChevronRight size={12} /></button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {loadingStage ? (
          <div className="agent-progress">
            <div className="progress-orbit"><Search size={15} /></div>
            <div><strong>{loadingStage === "searching" ? "Searching the web…" : "Structuring data…"}</strong><span>{loadingStage === "searching" ? "Finding trustworthy, current sources" : "Validating rows, columns, and chart shape"}</span></div>
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
                <div><strong>{userDataset.name}</strong><span>{userDataset.content.length.toLocaleString()} characters{userDataset.truncated ? " · trimmed" : ""}</span></div>
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
              <span>CSV · TSV · JSON · XLSX · TXT</span>
              <button onClick={() => fileRef.current?.click()} disabled={Boolean(loadingStage)}><Paperclip size={13} /> Choose file</button>
            </div>
            {dataError ? <p className="data-error">{dataError}</p> : null}
          </div>
        ) : null}
        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept=".csv,.tsv,.json,.xlsx,.txt,text/csv,text/tab-separated-values,application/json"
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
        <p>{userDataset ? "Your attached data is used for this analysis only." : "Polaris can make mistakes. Verify important data at the source."}</p>
      </div>
    </aside>
  );
}
