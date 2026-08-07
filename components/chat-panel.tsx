"use client";

import { ArrowUp, Bot, ChevronRight, PanelRightClose, PanelRightOpen, Search, Sparkles, UserRound } from "lucide-react";
import type { ChatMessage } from "@/types";

export const examplePrompts = [
  "显示微软最近 7 个交易日的收盘价",
  "显示加拿大央行最近一年的政策利率变化",
  "比较今天黄金和白银的价格",
];

type Props = {
  collapsed: boolean;
  query: string;
  messages: ChatMessage[];
  loadingStage: "searching" | "structuring" | null;
  onToggle: () => void;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  onFocusWidget: (id: string) => void;
};

export function ChatPanel({
  collapsed,
  query,
  messages,
  loadingStage,
  onToggle,
  onQueryChange,
  onSubmit,
  onFocusWidget,
}: Props) {
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
        <button className="icon-button" onClick={onToggle} aria-label="Collapse chat panel"><PanelRightClose size={17} /></button>
      </header>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="agent-avatar"><Sparkles size={18} /></div>
            <h3>What would you like to track?</h3>
            <p>I’ll search the live web, structure the numbers, and add one useful widget to your dashboard.</p>
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
            placeholder="Ask for live data…"
            aria-label="Ask Polaris for data"
          />
          <div><span>↵ send · ⇧↵ newline</span><button onClick={onSubmit} disabled={!query.trim() || Boolean(loadingStage)} aria-label="Send question"><ArrowUp size={17} /></button></div>
        </div>
        <p>Polaris can make mistakes. Verify important data at the source.</p>
      </div>
    </aside>
  );
}
