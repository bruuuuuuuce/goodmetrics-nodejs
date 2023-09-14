import {MetricsPipeline} from './metricsPipeline';
import {_Metrics} from '../_Metrics';
import {MetricsSink} from './metricsSink';

export class SynchronizingBuffer
  implements MetricsPipeline<_Metrics>, MetricsSink
{
  private metricsQueue: _Metrics[] = [];

  private *generatorFunc() {
    for (const metric of this.metricsQueue) {
      yield metric;
    }
  }
  *consume(): Generator<_Metrics, void, void> {
    const iterable = {[Symbol.iterator]: () => this.generatorFunc()};
    for (const element of iterable) {
      yield element;
    }
  }

  emit(metrics: _Metrics): Promise<void> {
    this.metricsQueue.push(metrics);
    return Promise.resolve(undefined);
  }
}
