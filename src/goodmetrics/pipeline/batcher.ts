import {MetricsPipeline} from './metricsPipeline';

interface Props<TUpstream> {
  upstream: MetricsPipeline<TUpstream>;
  batchSize?: number;
  batchAgeSeconds?: number;
}

export class Batcher<TUpstream> implements MetricsPipeline<TUpstream[]> {
  private readonly upstream: MetricsPipeline<TUpstream>;
  private readonly batchSize: number;
  private readonly batchAgeMillis: number;
  constructor(props: Props<TUpstream>) {
    this.upstream = props.upstream;
    this.batchSize = props.batchSize ?? 1000;
    this.batchAgeMillis = props.batchAgeSeconds
      ? props.batchAgeSeconds * 1000
      : 10 * 1000;
  }

  *consume(): Generator<TUpstream[], void, void> {
    let walkingBuffer: TUpstream[] = [];
    const currentBatchDeadline = Date.now() + this.batchAgeMillis;
    while (true) {
      if (
        Date.now() > currentBatchDeadline ||
        walkingBuffer.length > this.batchSize
      ) {
        yield walkingBuffer;
        walkingBuffer = [];
      }
      for (const metric of this.upstream.consume()) {
        walkingBuffer.push(metric);
        if (
          Date.now() > currentBatchDeadline ||
          walkingBuffer.length > this.batchSize
        ) {
          console.log('we are sad here');
          break;
        }
      }
    }
  }
}
