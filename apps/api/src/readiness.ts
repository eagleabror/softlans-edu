import mongoose from "mongoose";
// Coalesce public probes so a monitoring client cannot create a DB query storm.
export function databaseReadiness() {
  let cached = false,
    expiresAt = 0;
  let pending: Promise<boolean> | undefined;
  return async () => {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db)
      return false;
    if (Date.now() < expiresAt) return cached;
    pending ??= mongoose.connection.db
      .admin()
      .command({ ping: 1, maxTimeMS: 1000 }, { timeoutMS: 1500 })
      .then(
        () => true,
        () => false,
      )
      .then((ready) => {
        cached = ready;
        expiresAt = Date.now() + 5000;
        pending = undefined;
        return ready;
      });
    return pending;
  };
}
