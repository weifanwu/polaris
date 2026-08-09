import {
  agentTraceSchema,
  recoveryProposalSchema,
  widgetSpecSchema,
  type AgentTrace,
  type RecoveryProposal,
  type WidgetSpec,
} from "@/lib/widget-schema";

const APPROVAL_PATTERNS = [
  /^(?:可以|同意|接受|批准|继续|就这样(?:画)?|直接画|按(?:这个|你说的|建议|推荐)(?:来|画|做)?|你觉得怎么(?:好画|方便)(?:就)?怎么画|你觉得怎么好画[\s，,、]*怎么方便(?:就)?怎么画)[呢吧啊.!！。?？\s]*$/i,
  /^(?:yes|approve|approved|go ahead|do it|continue|use (?:the )?recommended chart|use (?:that|this) approach)[.!?\s]*$/i,
];

const DISMISS_PATTERNS = [
  /^(?:不用|算了|取消|拒绝|换一个|不要这个)[呢吧啊.!！。?？\s]*$/i,
  /^(?:no|cancel|dismiss|reject|not this one)[.!?\s]*$/i,
];

export function isRecoveryApproval(value: string) {
  const clean = value.trim();
  return clean.length > 0 && APPROVAL_PATTERNS.some((pattern) => pattern.test(clean));
}

export function isRecoveryDismissal(value: string) {
  const clean = value.trim();
  return clean.length > 0 && DISMISS_PATTERNS.some((pattern) => pattern.test(clean));
}

export function createRecoveryProposal(
  widget: WidgetSpec,
  description: string,
  proposedQuery: string,
  approvalLabel = "Use recommended chart",
): RecoveryProposal {
  const query = proposedQuery.trim().slice(0, 500) || widget.originalQuery;
  const validatedWidget = widgetSpecSchema.parse({
    ...widget,
    originalQuery: query,
  });
  return recoveryProposalSchema.parse({
    id: crypto.randomUUID(),
    title: validatedWidget.title,
    description: description.trim().slice(0, 500),
    approvalLabel,
    proposedQuery: query,
    widget: validatedWidget,
    createdAt: new Date().toISOString(),
  });
}

export function buildRecoveryExecutionTrace(proposal: RecoveryProposal): AgentTrace {
  const quality = proposal.widget.dataQuality;
  const coverage = quality
    ? `${quality.availablePoints}/${quality.requestedPoints} verified numeric observations${quality.coverageStart && quality.coverageEnd ? ` from ${quality.coverageStart} to ${quality.coverageEnd}` : ""}`
    : `${proposal.widget.rows.length} previously validated rows`;
  return agentTraceSchema.parse({
    mode: "fallback",
    summary: "Executed the approved recovery proposal from cached verified data without repeating research.",
    events: [
      {
        id: crypto.randomUUID(),
        kind: "route",
        status: "complete",
        title: "Alternative approved",
        detail: `The user approved: ${proposal.proposedQuery}`.slice(0, 500),
      },
      {
        id: crypto.randomUUID(),
        kind: "source",
        status: "complete",
        title: "Verified evidence reused",
        detail: `${coverage} were retained from the previous run. No Web Search or model call was made.`.slice(0, 500),
      },
      {
        id: crypto.randomUUID(),
        kind: "validation",
        status: "complete",
        title: "Cached widget contract revalidated",
        detail: `${proposal.widget.rows.length} rows and ${proposal.widget.columns.length} columns are ready to render; source citations and gaps were preserved.`,
      },
    ],
  });
}
