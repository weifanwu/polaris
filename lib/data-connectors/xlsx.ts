import { strFromU8, unzipSync } from "fflate";

export type SpreadsheetRow = {
  number: number;
  cells: Record<string, string>;
};

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readAttribute(attributes: string, name: string) {
  const escapedName = name.replace(":", "\\:");
  return attributes.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`))?.[1] ?? "";
}

function parseSharedStrings(xml: string) {
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (match) =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (text) => decodeXml(text[1])).join(""),
  );
}

function normalizeWorksheetPath(target: string) {
  const normalized = target.replace(/^\//, "").replace(/^\.\.\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function resolveWorksheetPath(workbookXml: string, relationshipsXml: string, sheetName: string) {
  const sheet = Array.from(workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)).find(
    (match) => decodeXml(readAttribute(match[1], "name")) === sheetName,
  );
  if (!sheet) throw new Error(`Worksheet not found: ${sheetName}`);

  const relationshipId = readAttribute(sheet[1], "r:id");
  const relationship = Array.from(relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)).find(
    (match) => readAttribute(match[1], "Id") === relationshipId,
  );
  if (!relationship) throw new Error(`Worksheet relationship not found: ${sheetName}`);

  return normalizeWorksheetPath(readAttribute(relationship[1], "Target"));
}

function parseCellValue(body: string, type: string, sharedStrings: string[]) {
  if (type === "inlineStr") {
    return Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (match) => decodeXml(match[1])).join("");
  }

  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return "";
  if (type === "s") return sharedStrings[Number.parseInt(raw, 10)] ?? "";
  return decodeXml(raw);
}

export function readWorksheet(workbook: ArrayBuffer, sheetName: string): SpreadsheetRow[] {
  const files = unzipSync(new Uint8Array(workbook));
  const workbookXml = files["xl/workbook.xml"];
  const relationshipsXml = files["xl/_rels/workbook.xml.rels"];
  if (!workbookXml || !relationshipsXml) throw new Error("Invalid XLSX workbook structure");

  const worksheetPath = resolveWorksheetPath(
    strFromU8(workbookXml),
    strFromU8(relationshipsXml),
    sheetName,
  );
  const worksheet = files[worksheetPath];
  if (!worksheet) throw new Error(`Worksheet payload not found: ${sheetName}`);

  const sharedStrings = files["xl/sharedStrings.xml"]
    ? parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"]))
    : [];
  const xml = strFromU8(worksheet);

  return Array.from(xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g), (rowMatch) => {
    const number = Number.parseInt(readAttribute(rowMatch[1], "r"), 10);
    const cells: Record<string, string> = {};
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = readAttribute(cellMatch[1], "r");
      const column = reference.match(/^[A-Z]+/)?.[0];
      if (!column) continue;
      cells[column] = parseCellValue(
        cellMatch[2],
        readAttribute(cellMatch[1], "t"),
        sharedStrings,
      );
    }
    return { number, cells };
  }).filter((row) => Number.isFinite(row.number));
}
