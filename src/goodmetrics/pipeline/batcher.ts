import {MetricsPipeline} from './metricsPipeline';
import {CancellationToken} from './cancellationToken';

interface Props<TUpstream> {
  upstream: MetricsPipeline<TUpstream>;
  batchSize?: number;
  batchAgeSeconds?: number;
}

const TimeoutToken = Symbol('Timeout');

export class Batcher<TUpstream> implements MetricsPipeline<TUpstream[]> {
  private readonly upstream: MetricsPipeline<TUpstream>;
  private readonly batchSize: number;
  private readonly batchAgeMillis: number;
  private readonly cancellationToken: CancellationToken;
  private batchTimeoutId: NodeJS.Timeout | undefined;
  constructor(props: Props<TUpstream>) {
    this.consume = this.consume.bind(this);
    this.upstream = props.upstream;
    this.batchSize = props.batchSize ?? 1000;
    this.batchAgeMillis = props.batchAgeSeconds
      ? props.batchAgeSeconds * 1000
      : 10 * 1000;
    this.cancellationToken = new CancellationToken();
  }

  private batchTimeout = async (): Promise<symbol> => {
    return await new Promise(resolve => {
      this.batchTimeoutId = setTimeout(() => {
        resolve(TimeoutToken);
      }, this.batchAgeMillis);
    });
  };

  async *consume(): AsyncGenerator<TUpstream[], void, void> {
    const walkingBuffer: TUpstream[] = [];

    const retrieveItemsFromUpstream = async () => {
      for await (const metric of this.upstream.consume()) {
        walkingBuffer.push(metric);
        if (walkingBuffer.length >= this.batchSize) {
          return;
        }
      }
    };
    while (true) {
      // clear the walking buffer at the start
      walkingBuffer.length = 0;
      const x = retrieveItemsFromUpstream();
      const res = await Promise.race([
        this.batchTimeout(),
        this.cancellationToken.promise,
        x,
      ]);
      // don't want to cause any memory leaks
      clearTimeout(this.batchTimeoutId);

      if (res === CancellationToken.CANCEL) {
        return;
      }

      yield walkingBuffer;
    }
  }
}
