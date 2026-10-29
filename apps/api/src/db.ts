import mongoose from "mongoose";
export async function connectDatabase(uri: string) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (
    !hello.setName ||
    typeof hello.logicalSessionTimeoutMinutes !== "number"
  ) {
    await mongoose.disconnect();
    throw new Error("MongoDB must be a replica set with session support");
  }
}
