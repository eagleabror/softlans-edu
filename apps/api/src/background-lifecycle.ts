// Tracks work acknowledged by HTTP but still running after the response closes.
export class BackgroundLifecycle {
  private controller = new AbortController();
  private jobs = new Set<Promise<unknown>>();
  get stopping() {
    return this.controller.signal.aborted;
  }
  get activeCount() {
    return this.jobs.size;
  }
  start(work: (signal: AbortSignal) => Promise<unknown>) {
    if (this.stopping) return false;
    const job = Promise.resolve().then(() => work(this.controller.signal));
    this.jobs.add(job);
    // Consume unexpected rejections without logging potentially sensitive errors.
    void job
      .catch(() => {
        console.error(
          JSON.stringify({
            event: "background_job",
            code: "UNHANDLED_FAILURE",
          }),
        );
      })
      .finally(() => this.jobs.delete(job));
    return true;
  }
  stop() {
    this.controller.abort();
  }
  async drain() {
    await Promise.allSettled([...this.jobs]);
  }
}
