import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
process.env.MONGOMS_DOWNLOAD_DIR ??= fileURLToPath(
  new URL("../../work/mongodb-binaries", import.meta.url),
);
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
