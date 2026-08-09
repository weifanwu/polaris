export type UserDataset = {
  name: string;
  format: "csv" | "tsv" | "json" | "text" | "xlsx" | "pdf";
  content: string;
  fileData?: string;
  fileUrl?: string;
  byteSize?: number;
  truncated?: boolean;
  origin?: "attachment" | "dashboard" | "remote";
};

export const MAX_USER_DATA_CHARS = 180_000;
export const MAX_USER_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_FILE_CHARS = Math.ceil(MAX_USER_FILE_BYTES * 4 / 3) + 128;

export function parseUserDataset(value: unknown): UserDataset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.content !== "string") return null;
  const format = candidate.format;
  if (!(["csv", "tsv", "json", "text", "xlsx", "pdf"] as const).includes(format as UserDataset["format"])) {
    return null;
  }
  const name = candidate.name.trim().slice(0, 120) || "User data";
  if (format === "pdf") {
    if (typeof candidate.fileData !== "string"
      || !candidate.fileData.startsWith("data:application/pdf;base64,")
      || candidate.fileData.length > MAX_BASE64_FILE_CHARS) return null;
    const byteSize = typeof candidate.byteSize === "number"
      ? Math.max(0, Math.min(Math.round(candidate.byteSize), MAX_USER_FILE_BYTES))
      : undefined;
    return {
      name,
      content: "",
      format: "pdf",
      fileData: candidate.fileData,
      ...(byteSize === undefined ? {} : { byteSize }),
      truncated: false,
      origin: "attachment",
    };
  }
  const content = candidate.content.trim();
  if (!content || content.length > MAX_USER_DATA_CHARS) return null;
  return {
    name,
    content,
    format: format as UserDataset["format"],
    truncated: candidate.truncated === true,
    origin: candidate.origin === "dashboard" ? "dashboard" : "attachment",
  };
}

export function userDatasetSizeLabel(dataset: UserDataset) {
  if (dataset.fileUrl) return "remote file";
  if (dataset.byteSize !== undefined) {
    return dataset.byteSize >= 1024 * 1024
      ? `${(dataset.byteSize / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(dataset.byteSize / 1024)).toLocaleString()} KB`;
  }
  return `${dataset.content.length.toLocaleString()} characters`;
}

const REMOTE_FILE_EXTENSIONS = new Set(["csv", "tsv", "json", "txt", "xlsx", "xls", "pdf"]);

export function remoteDatasetFromUrl(value: string): UserDataset | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "remote-data").slice(0, 120);
    const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
    if (!REMOTE_FILE_EXTENSIONS.has(extension)) return null;
    const format: UserDataset["format"] = extension === "pdf" ? "pdf"
      : extension === "xlsx" || extension === "xls" ? "xlsx"
        : extension === "csv" || extension === "tsv" || extension === "json" ? extension
          : "text";
    return {
      name: filename || `remote-data.${extension}`,
      format,
      content: "",
      fileUrl: url.toString(),
      origin: "remote",
    };
  } catch {
    return null;
  }
}
