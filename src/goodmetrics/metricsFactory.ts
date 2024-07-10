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

export type LogLevel = 'none' | 'debug' | 'info' | 'error';

interface Props {
  metricsSink: MetricsSink;
  totalTimeType: TotaltimeType;
  logLevel?: LogLevel;
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

const NONE_LEVEL = 0;
const DEBUG_LEVEL = 1;
const INFO_LEVEL = 2;
const ERROR_LEVEL = 3;

class Logger {
  private readonly level: number;
  constructor(level: LogLevel) {
    switch (level) {
      case 'none':
        this.level = NONE_LEVEL;
        break;
      case 'debug':
        this.level = DEBUG_LEVEL;
        break;
      case 'info':
        this.level = INFO_LEVEL;
        break;
      case 'error':
        this.level = ERROR_LEVEL;
        break;
    }
  }

  debug(message: string, additionalContext?: {[key: string]: unknown}): void {
    if (this.level >= DEBUG_LEVEL) {
      console.debug(message, additionalContext);
    }
  }

  info(message: string, additionalContext?: {[key: string]: unknown}): void {
    if (this.level >= INFO_LEVEL) {
      console.info(message, additionalContext);
    }
  }

  error(message: string, additionalContext?: {[key: string]: unknown}): void {
    if (this.level >= ERROR_LEVEL) {
      console.error(message, additionalContext);
    }
  }
}

export class MetricsFactory {
  protected readonly metricsSink: MetricsSink;
  private readonly totalTimeType: TotaltimeType;
  private readonly logger: Logger;
  constructor(props: Props) {
    this.metricsSink = props.metricsSink;
    this.totalTimeType = props.totalTimeType;
    this.logger = new Logger(props.logLevel ?? 'none');
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
      await this.emit(metrics);
    }
  }

  /**
   * Complete and release a Metrics to the configured downstream sink.
   * If you don't emit() the metrics it will never show up downstream.
   */
  private async emit(metrics: _Metrics) {
    this.finalizeMetrics(metrics);
    this.logger.debug('metrics finalized', {metrics});
    await this.metricsSink.emit(metrics);
  }

  private finalizeMetrics(metrics: _Metrics) {
    this.logger.debug('finalizing metrics');
    if (metrics.timestampMillis < 1) {
      metrics.timestampMillis = Date.now();
    }
    if (metrics.metricsBehavior === MetricsBehavior.NO_TOTALTIME) {
      this.logger.debug('no total time being recorded');
      return;
    }

    const duration = metrics.getDurationMillis();
    switch (this.totalTimeType) {
      case TotaltimeType.DistributionMilliseconds:
        this.logger.debug(`distribution milliseconds, duration: ${duration}`);
        metrics.distribution('totaltime', duration);
        break;
      case TotaltimeType.MeasurementMilliseconds:
        this.logger.debug(`measurement milliseconds, duration: ${duration}`);
        metrics.measure('totaltime', duration);
        break;
      case TotaltimeType.None:
        this.logger.debug(`totaltime.none, duration: ${duration}`);
        break;
    }
  }
}
