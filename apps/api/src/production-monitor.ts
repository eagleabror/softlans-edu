import type { Config } from "./config.js";
import type { BackgroundLifecycle } from "./background-lifecycle.js";
import { databaseReadiness } from "./readiness.js";
import { platformNotificationSnapshot } from "./notification-monitoring.js";
import { evaluateAlerts, sendOperatorAlert } from "./operational-alerts.js";
export function startProductionMonitor(
  config: Config,
  lifecycle: BackgroundLifecycle,
) {
  const databaseReady = databaseReadiness();
  let running = false;
  const tick = () => {
    if (running || lifecycle.stopping) return;
    running = true;
    lifecycle.start(async (signal) => {
      try {
        if (!(await databaseReady())) {
          console.error(
            JSON.stringify({
              event: "production_monitor",
              code: "DATABASE_UNAVAILABLE",
            }),
          );
          return; // External /ready monitoring is required when MongoDB cannot deduplicate alerts.
        }
        const snapshot = await platformNotificationSnapshot(
          new Date(),
          config.MONITOR_SCHEDULER_STALE_SECONDS * 1000,
        );
        const codes = evaluateAlerts(snapshot, config);
        console.info(
          JSON.stringify({
            event: "production_monitor",
            status: "sampled",
            processor: snapshot.processor.state,
            stage: snapshot.processor.stage,
            pending:
              snapshot.queue.counts.pending +
              snapshot.legacyQueue.counts.pending,
            sending:
              snapshot.queue.counts.sending +
              snapshot.legacyQueue.counts.sending,
            failed:
              snapshot.queue.counts.failed + snapshot.legacyQueue.counts.failed,
            cancelled:
              snapshot.queue.counts.cancelled +
              snapshot.legacyQueue.counts.cancelled,
            codes,
            alertsEnabled: config.OPERATOR_ALERTS_ENABLED,
            suppressed: config.OPERATOR_ALERTS_SUPPRESSED,
          }),
        );
        for (const code of codes) {
          if (signal.aborted) break;
          await sendOperatorAlert(config, code);
        }
      } catch {
        console.error(
          JSON.stringify({
            event: "production_monitor",
            code: "MONITOR_FAILED",
          }),
        );
      } finally {
        running = false;
      }
    });
  };
  // Delay first sample to avoid false stale alerts during application startup.
  const timer = setInterval(tick, 60_000).unref();
  return () => clearInterval(timer);
}
