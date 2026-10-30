import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
export const MAX_BYTES = 5 * 1024 * 1024;
export type ImportTable = {
  sheets: string[];
  headers: string[];
  rows: string[][];
};
// Check expanded ZIP size before handing a workbook to the XML parser.
async function inspectZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("ZIP"));
      let size = 0,
        entries = 0;
      const fail = () => {
        zip.close();
        reject(new Error("ZIP"));
      };
      zip.on("error", fail);
      zip.on("entry", (entry: yauzl.Entry) => {
        size += entry.uncompressedSize;
        if (
          ++entries > 300 ||
          size > 20 * 1024 * 1024 ||
          entry.generalPurposeBitFlag & 1 ||
          /vbaProject|externalLinks|embeddings|activeX/i.test(entry.fileName)
        )
          return fail();
        zip.readEntry();
      });
      zip.on("end", resolve);
      zip.readEntry();
    });
  });
}
export async function parseImport(
  buffer: Buffer,
  filename: string,
  sheet = 0,
): Promise<ImportTable> {
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error("SIZE");
  let rows: string[][], sheets: string[];
  if (/\.csv$/i.test(filename)) {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
      /^\s*</.test(text) ||
      sheet !== 0
    )
      throw new Error("CSV");
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    const delimiter = first.includes(";") && !first.includes(",") ? ";" : ",";
    rows = parse(text, {
      delimiter,
      skip_empty_lines: true,
      max_record_size: 32768,
      relax_column_count: false,
    });
    sheets = ["CSV"];
  } else if (
    /\.xlsx$/i.test(filename) &&
    buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  ) {
    await inspectZip(buffer);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as never);
    sheets = book.worksheets.map((s) => s.name);
    const selected = book.worksheets[sheet];
    if (!selected || selected.rowCount > 2001 || selected.columnCount > 32)
      throw new Error("LIMIT");
    rows = [];
    selected.eachRow({ includeEmpty: true }, (row) => {
      const values: string[] = [];
      for (let i = 1; i <= selected.columnCount; i++) {
        const cell = row.getCell(i),
          value = cell.value;
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          (value && typeof value === "object" && !(value instanceof Date))
        )
          throw new Error("FORMULA");
        values.push(
          value instanceof Date
            ? value.toISOString().slice(0, 10)
            : String(value ?? ""),
        );
      }
      rows.push(values);
    });
  } else throw new Error("FORMAT");
  if (
    rows.length < 2 ||
    rows.length > 2001 ||
    !rows[0]?.length ||
    rows[0].length > 32 ||
    rows.some((r) => r.length > 32 || r.some((c) => c.length > 2000))
  )
    throw new Error("LIMIT");
  const headers = rows.shift()!.map((h) => h.trim());
  return { sheets, headers, rows };
}
