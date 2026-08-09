import { z } from "zod";

export const visualizationSchema = z.enum([
  "table",
  "line_chart",
  "bar_chart",
  "metric",
]);

export const columnSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  dataType: z.enum(["string", "number", "date"]),
  unit: z.string().max(40).nullable(),
});

export const rowSchema = z.object({
  cells: z.array(z.string().max(300)).max(6),
});

export const sourceSchema = z.object({
  title: z.string().min(1).max(180),
  url: z.string().url().max(2_000),
});

export const dataQualitySchema = z.object({
  method: z.enum(["official_connector", "web_search", "user_data"]),
  sourceName: z.string().min(1).max(120),
  requestedPoints: z.number().int().nonnegative(),
  availablePoints: z.number().int().nonnegative(),
  missingPoints: z.number().int().nonnegative(),
  coverageStart: z.string().max(40).nullable(),
  coverageEnd: z.string().max(40).nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "mixed", "unknown"]),
  verifiedAt: z.string().datetime(),
  scope: z.string().max(240).optional(),
});

export const widgetSpecSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(120),
    subtitle: z.string().max(220),
    visualization: visualizationSchema,
    columns: z.array(columnSchema).min(1).max(6),
    rows: z.array(rowSchema).min(1).max(120),
    summary: z.string().max(500),
    originalQuery: z.string().min(1).max(500),
    sources: z.array(sourceSchema).max(5),
    generatedAt: z.string().datetime(),
    dataQuality: dataQualitySchema.optional(),
  })
  .superRefine((widget, ctx) => {
    widget.rows.forEach((row, index) => {
      if (row.cells.length !== widget.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "cells"],
          message: "Each row must have exactly one cell per column.",
        });
      }
    });

    if (
      widget.visualization !== "table" &&
      !widget.columns.some((column) => column.dataType === "number")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Charts and metrics require at least one numeric column.",
      });
    }
  });

export const generateWidgetResultSchema = z.object({
  status: z.enum(["success", "needs_clarification", "cannot_answer"]),
  message: z.string().min(1).max(500),
  widget: widgetSpecSchema.nullable(),
  conversationContext: z.string().max(500).optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      cachedInputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      webSearchCalls: z.number().int().nonnegative(),
      modelCalls: z.number().int().nonnegative(),
    })
    .optional(),
});

export const intentResolutionSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  message: z.string(),
  resolvedQuery: z.string(),
  researchMode: z.enum(["simple", "complex"]),
  allowPartialData: z.boolean(),
});

// Keep the model-facing schema within Structured Outputs' supported JSON Schema subset.
export const modelWidgetResultSchema = z.object({
  status: z.enum(["success", "needs_clarification", "cannot_answer"]),
  message: z.string(),
  widget: z
    .object({
      title: z.string(),
      subtitle: z.string(),
      visualization: visualizationSchema,
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          dataType: z.enum(["string", "number", "date"]),
          unit: z.string().nullable(),
        }),
      ),
      rows: z.array(z.object({ cells: z.array(z.string()) })),
      summary: z.string(),
    })
    .nullable(),
});

export type WidgetSpec = z.infer<typeof widgetSpecSchema>;
export type GenerateWidgetResult = z.infer<typeof generateWidgetResultSchema>;
export type ModelWidgetResult = z.infer<typeof modelWidgetResultSchema>;
export type RequestUsage = NonNullable<GenerateWidgetResult["usage"]>;
