import { expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "../src/db.js";

it("refuses standalone MongoDB before serving a registration-capable application", async () => {
  const standalone = await MongoMemoryServer.create({
    binary: { version: "7.0.24" },
  });
  try {
    await expect(
      connectDatabase(standalone.getUri("softlans_edu_test")),
    ).rejects.toThrow("MongoDB must be a replica set with session support");
    expect(mongoose.connection.readyState).toBe(0);
  } finally {
    await mongoose.disconnect();
    await standalone.stop();
  }
});
