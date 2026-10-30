import { parseImport } from "./import-parser.js";
process.once(
  "message",
  async (message: { data: string; filename: string; sheet: number }) => {
    try {
      process.send?.({
        table: await parseImport(
          Buffer.from(message.data, "base64"),
          message.filename,
          message.sheet,
        ),
      });
    } catch {
      process.send?.({ error: true });
    } finally {
      process.disconnect();
    }
  },
);
