/** Debounced, one-in-flight synchronization of authored edits for one session. */
export class SequencerConfigSync<T, R> {
  private session: string | null = null;
  private revision = -1;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { revision: number; payload: T } | null = null;
  private inFlight = false;
  private ready = false;

  constructor(
    private readonly send: (session: string, payload: T) => Promise<R>,
    private readonly applied: (result: R) => void,
    private readonly failed: (error: unknown) => void,
    private readonly busy: (value: boolean) => void = () => undefined
  ) {}

  baseline(session: string, revision: number): void {
    this.stop();
    this.session = session;
    this.revision = revision;
  }

  edit(session: string, revision: number, payload: T): void {
    if (!this.needsEdit(session, revision)) return;
    this.revision = revision;
    this.pending = { revision, payload };
    this.ready = false;
    this.busy(true);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.ready = true; this.flush(); }, 80);
  }

  needsEdit(session: string, revision: number): boolean {
    return session === this.session && revision > this.revision;
  }

  stop(): void {
    this.epoch += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.session = null;
    this.pending = null;
    this.inFlight = false;
    this.ready = false;
    this.busy(false);
  }

  private flush(): void {
    if (!this.session || !this.pending || this.inFlight || !this.ready) return;
    const job = this.pending;
    const epoch = this.epoch;
    this.pending = null;
    this.inFlight = true;
    const session = this.session;
    void Promise.resolve().then(() => this.send(session, job.payload)).then(result => {
      if (epoch === this.epoch && job.revision === this.revision) this.applied(result);
    }).catch(error => {
      if (epoch === this.epoch && job.revision === this.revision) this.failed(error);
    }).finally(() => {
      if (epoch !== this.epoch) return;
      this.inFlight = false;
      if (this.pending) this.flush();
      else this.busy(false);
    });
  }
}
