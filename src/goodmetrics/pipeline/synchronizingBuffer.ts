import {MetricsPipeline} from './metricsPipeline';
import {_Metrics} from '../_Metrics';
import {MetricsSink} from './metricsSink';
import {CancellationToken} from './cancellationToken';

type SynchronizingBufferProps = {
  queueSize?: number;
};

export class SynchronizingBuffer
  implements MetricsPipeline<_Metrics>, MetricsSink
{
  private readonly metricsQueue: _Metrics[] = [];
  private readonly queueSize: number;
  private readonly cancellationToken: CancellationToken;
  private _res: (elementAdded: symbol) => void;
  private waitForElePromise = new Promise(res => (this._res = res));

  constructor(props?: SynchronizingBufferProps) {
    this.queueSize = props?.queueSize ?? 1024;
    this.cancellationToken = new CancellationToken();
  }

  private elementAdded = () => {
    this._res(Symbol());
    this.waitForElePromise = new Promise(res => (this._res = res));
  };

  async *consume(): AsyncGenerator<_Metrics, void, void> {
    // consume _forever_
    while (true) {
      let metric = this.metricsQueue.pop();
      while (metric) {
        yield metric;
        metric = this.metricsQueue.pop();
      }
      const res = await Promise.race([
        this.waitForElePromise,
        this.cancellationToken.promise,
      ]);
      if (res === CancellationToken.CANCEL) {
        return;
      }
    }
  }

  emit(metrics: _Metrics): void {
    this.metricsQueue.push(metrics);
    const overflow = this.metricsQueue.length - this.queueSize;
    if (overflow > 0) {
      // trim the metrics queue
      this.metricsQueue.splice(0, overflow);
    }
    // let our consumer know that there are more elements to process
    this.elementAdded();
  }

  close() {
    this.cancellationToken.cancel();
  }
}
