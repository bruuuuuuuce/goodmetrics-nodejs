import {_Metrics, Metrics, MetricsBehavior} from './_Metrics';
import {MetricsSink} from './pipeline/metricsSink';

export enum TimestampAt {
  // Stamp the metric at the start
  Start = 'start',

  // Stamp the metric at the end
  End = 'end',
}

export enum TotaltimeType {
  /**
   * totaltime is a histogram (preferred)
   */
  DistributionMilliseconds = 'distribution_milliseconds',

  /**
   * totaltime is a statisticset when preaggregated
   */
  MeasurementMilliseconds = 'measurement_milliseconds',

  /**
   * No totaltime metric
   */
  None = 'none',
}

interface Props {
  metricsSink: MetricsSink;
  totalTimeType: TotaltimeType;
}

export class MetricsFactory {
  protected readonly metricsSink: MetricsSink;
  private readonly totalTimeType: TotaltimeType;
  constructor(props: Props) {
    this.metricsSink = props.metricsSink;
    this.totalTimeType = props.totalTimeType;
  }

  /**
   * For every getMetrics(), you need to also emit() that Metrics object via this same MetricsFactory.
   */
  private getMetrics(
    name: string,
    stampAt: TimestampAt,
    metricsBehavior: MetricsBehavior = MetricsBehavior.DEFAULT
  ): _Metrics {
    let timestamp: number;
    switch (stampAt) {
      case TimestampAt.Start:
        timestamp = performance.now();
        break;
      case TimestampAt.End:
        timestamp = -1;
        break;
    }

    return new _Metrics({
      name,
      timestampMillis: timestamp,
      startMilliTime: performance.now(),
      metricsBehavior,
    });
  }

  async record<T>(
    name: string,
    stampAt: TimestampAt,
    block: (metrics: Metrics) => Promise<T> | T
  ): Promise<T> {
    return await this.recordWithBehavior(
      name,
      stampAt,
      MetricsBehavior.DEFAULT,
      block
    );
  }

  async recordWithBehavior<T>(
    name: string,
    stampAt: TimestampAt,
    metricsBehavior: MetricsBehavior,
    block: (metrics: Metrics) => Promise<T> | T
  ): Promise<T> {
    const metrics = this.getMetrics(name, stampAt, metricsBehavior);
    try {
      const res = await block(metrics);
      return res;
    } finally {
      this.emit(metrics);
    }
  }

  /**
   * Complete and release a Metrics to the configured downstream sink.
   * If you don't emit() the metrics it will never show up downstream.
   */
  private emit(metrics: _Metrics) {
    this.finalizeMetrics(metrics);
    this.metricsSink.emit(metrics);
  }

  private finalizeMetrics(metrics: _Metrics) {
    if (metrics.timestampMillis < 1) {
      metrics.timestampMillis = performance.now();
    }
    if (metrics.metricsBehavior === MetricsBehavior.NO_TOTALTIME) {
      return;
    }

    const duration = performance.now() - metrics.startMilliTime;
    switch (this.totalTimeType) {
      case TotaltimeType.DistributionMilliseconds:
        metrics.distribution('totaltime', duration);
        break;
      case TotaltimeType.MeasurementMilliseconds:
        metrics.measure('totaltime', duration);
        break;
      case TotaltimeType.None:
        break;
    }
  }
}
