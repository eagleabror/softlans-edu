import mongoose from "mongoose";
import { assertIsolatedMongoUri } from "./mongo-uri.js";

// Empty strings also bypass a nullish fallback in older tests. Remove inherited
// database targets entirely, forcing every test to create its disposable server.
delete process.env.TEST_MONGODB_URI;
delete process.env.MONGODB_URI;

// Covers mongoose.connect(), createConnection() and Connection.openUri().
// Only loaded by Vitest; production connection behavior is untouched.
const openUri = mongoose.Connection.prototype.openUri;
mongoose.Connection.prototype.openUri = function (uri, ...options) {
  assertIsolatedMongoUri(uri);
  return openUri.call(this, uri, ...options);
};
