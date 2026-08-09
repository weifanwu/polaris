export type UserDataset = {
  name: string;
  format: "csv" | "tsv" | "json" | "text" | "xlsx";
  content: string;
  truncated?: boolean;
};

export const MAX_USER_DATA_CHARS = 180_000;

export function parseUserDataset(value: unknown): UserDataset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.content !== "string") return null;
  const format = candidate.format;
  if (!(["csv", "tsv", "json", "text", "xlsx"] as const).includes(format as UserDataset["format"])) {
    return null;
  }
  const name = candidate.name.trim().slice(0, 120) || "User data";
  const content = candidate.content.trim();
  if (!content || content.length > MAX_USER_DATA_CHARS) return null;
  return {
    name,
    content,
    format: format as UserDataset["format"],
    truncated: candidate.truncated === true,
  };
}
