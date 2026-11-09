import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { assertIsolatedMongoUri } from "./setup/mongo-uri.js";

describe("test bazasi izolyatsiyasi", () => {
  it.each([
    "mongodb://127.0.0.1:27017/softlans_test?replicaSet=testset",
    "mongodb://localhost:37017/test",
    "mongodb://127.0.0.1:27017/?replicaSet=testset",
    "mongodb://[::1]:27017/test",
  ])("lokal sintetik manzilga ruxsat beradi: %s", (uri) => {
    expect(() => assertIsolatedMongoUri(uri)).not.toThrow();
  });

  it.each([
    "mongodb+srv://production.example.com/softlans_edu_test",
    "mongodb://production.example.com:27017/softlans_edu_test",
    "mongodb://127.0.0.1.evil.com:27017/test",
    "mongodb://127.0.0.1:27017,remote:27017/test",
    "mongodb://user:password@127.0.0.1:27017/test",
    "mongodb://127.0.0.1:27017@remote:27017/test",
    "mongodb://127.0.0.1:27017/test?proxyHost=remote",
    "mongodb://127.0.0.1:27017/test?tlsCAFile=/secret",
  ])("ulanishdan oldin tashqi manzilni rad etadi: %s", (uri) => {
    expect(() => assertIsolatedMongoUri(uri)).toThrow(/izolyatsiyalangan/);
    expect(() => mongoose.createConnection(uri)).toThrow(/izolyatsiyalangan/);
  });
});
