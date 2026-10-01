import {MetricsPipeline} from './metricsPipeline';
import {CancellationToken} from './cancellationToken';

interface Props<TUpstream> {
  upstream: MetricsPipeline<TUpstream>;
  batchSize?: number;
  batchAgeSeconds?: number;
}

export function validateBatchSize(batchSize: number, name = 'batchSize'): void {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function validateBatchAgeSeconds(
  batchAgeSeconds: number,
  name = 'batchAgeSeconds'
): void {
  if (!Number.isFinite(batchAgeSeconds) || batchAgeSeconds < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

export class Batcher<TUpstream> implements MetricsPipeline<TUpstream[]> {
  private readonly upstream: MetricsPipeline<TUpstream>;
  private readonly batchSize: number;
  private readonly batchAgeMillis: number;
  private readonly cancellationToken: CancellationToken;
  private batchTimeoutId: NodeJS.Timeout | undefined;
  constructor(props: Props<TUpstream>) {
    this.consume = this.consume.bind(this);
    this.upstream = props.upstream;
    const batchSize = props.batchSize ?? 1000;
    validateBatchSize(batchSize);
    this.batchSize = batchSize;
    validateBatchAgeSeconds(props.batchAgeSeconds ?? 10);
    this.batchAgeMillis = props.batchAgeSeconds
      ? props.batchAgeSeconds * 1000
      : 10 * 1000;
    this.cancellationToken = new CancellationToken();
  }

  private batchTimeout = async (): Promise<void> => {
    return await new Promise(resolve => {
      this.batchTimeoutId = setTimeout(() => {
        resolve();
      }, this.batchAgeMillis);
    });
  };

  async *consume(): AsyncGenerator<TUpstream[], void, void> {
    const upstream = this.upstream.consume();
    let pendingNext: Promise<void> | undefined;
    let nextResult: IteratorResult<TUpstream> | undefined;
    let upstreamError: unknown;
    let upstreamFailed = false;
    let cancelled = this.cancellationToken.isCancelled();
    let wakeCurrentWait: (() => void) | undefined;
    void this.cancellationToken.promise.then(() => {
      cancelled = true;
      wakeCurrentWait?.();
    });
    try {
      while (true) {
        const batch: TUpstream[] = [];
        let timedOut = false;
        void this.batchTimeout().then(() => {
          timedOut = true;
          wakeCurrentWait?.();
        });
        let upstreamDone = false;
        while (batch.length < this.batchSize) {
          if (cancelled) {
            return;
          }
          pendingNext ??= upstream.next().then(
            item => {
              nextResult = item;
              wakeCurrentWait?.();
            },
            error => {
              upstreamError = error;
              upstreamFailed = true;
              wakeCurrentWait?.();
            }
          );
          if (!nextResult && !upstreamFailed && !timedOut) {
            await new Promise<void>(resolve => {
              wakeCurrentWait = resolve;
            });
            wakeCurrentWait = undefined;
          }
          if (cancelled) return;
          if (upstreamFailed) throw upstreamError;
          if (!nextResult) break;
          const item = nextResult;
          nextResult = undefined;
          pendingNext = undefined;
          if (item.done) {
            upstreamDone = true;
            break;
          }
          batch.push(item.value);
        }
        clearTimeout(this.batchTimeoutId);
        if (upstreamDone && batch.length === 0) {
          return;
        }
        yield batch;
        if (upstreamDone) {
          return;
        }
      }
    } finally {
      clearTimeout(this.batchTimeoutId);
      if (!pendingNext) {
        await upstream.return?.();
      }
    }
  }

  close(): void {
    this.cancellationToken.cancel();
  }
}
