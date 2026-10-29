import mongoose from "mongoose";
export class ReplicaSetRequiredError extends Error {
  constructor() {
    super("MongoDB must be a replica set with session support");
  }
}
export async function openDatabaseConnection(uri: string) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });
}
export async function verifyReplicaSet() {
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (
    !hello.setName ||
    typeof hello.logicalSessionTimeoutMinutes !== "number"
  ) {
    throw new ReplicaSetRequiredError();
  }
}
// Keep scripts and integration callers on the same fail-closed database checks.
export async function connectDatabase(uri: string) {
  await openDatabaseConnection(uri);
  try {
    await verifyReplicaSet();
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}
