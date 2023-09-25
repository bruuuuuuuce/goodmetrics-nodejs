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

interface RecordOptions {
  name: string;
  stampAt?: TimestampAt;
}

interface RecordWithBehaviorOptions {
  name: string;
  stampAt?: TimestampAt;
  behavior: MetricsBehavior;
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
        timestamp = Date.now();
        break;
      case TimestampAt.End:
        timestamp = -1;
        break;
    }

    return new _Metrics({
      name,
      timestampMillis: timestamp,
      metricsBehavior,
    });
  }

  async record<T>(
    options: RecordOptions,
    block: (metrics: Metrics) => Promise<T> | T
  ): Promise<T> {
    return await this.recordWithBehavior(
      {
        name: options.name,
        stampAt: options.stampAt,
        behavior: MetricsBehavior.DEFAULT,
      },
      block
    );
  }

  async recordWithBehavior<T>(
    options: RecordWithBehaviorOptions,
    block: (metrics: Metrics) => Promise<T> | T
  ): Promise<T> {
    const stampAt = options.stampAt ?? TimestampAt.Start;
    const metrics = this.getMetrics(options.name, stampAt, options.behavior);
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
      metrics.timestampMillis = Date.now();
    }
    if (metrics.metricsBehavior === MetricsBehavior.NO_TOTALTIME) {
      return;
    }

    const duration = metrics.getDurationMillis();
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
