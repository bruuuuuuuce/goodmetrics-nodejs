import {otlp_common, otlp_metrics} from 'otlp-generated';
import {bucket, bucketBelow} from './pipeline/aggregator';
import Metric = otlp_metrics.opentelemetry.proto.metrics.v1.Metric;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;
import AnyValue = otlp_common.opentelemetry.proto.common.v1.AnyValue;
import Gauge = otlp_metrics.opentelemetry.proto.metrics.v1.Gauge;
import Histogram = otlp_metrics.opentelemetry.proto.metrics.v1.Histogram;
import HistogramDataPoint = otlp_metrics.opentelemetry.proto.metrics.v1.HistogramDataPoint;
import AggregationTemporality = otlp_metrics.opentelemetry.proto.metrics.v1.AggregationTemporality;
import {newNumberDataPoint} from './data/otlp/numbersDataPoint';
import {goodmetrics} from 'goodmetrics-generated';

export enum MetricsBehavior {
  DEFAULT = 'default',
  NO_TOTALTIME = 'no_totaltime', // don't include a `totaltime` timeseries for the metric
}

export abstract class Dimension {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }

  abstract asOtlpKeyValue(): KeyValue;

  abstract asGoodmetricsDimension(): goodmetrics.Dimension;
}

export class StringDimension extends Dimension {
  readonly value: string;
  constructor(name: string, value: string) {
    super(name);
    this.value = value;
  }

  asOtlpKeyValue(): KeyValue {
    const value = new AnyValue({string_value: this.value});
    return new KeyValue({key: this.name, value});
  }

  asGoodmetricsDimension(): goodmetrics.Dimension {
    return new goodmetrics.Dimension({
      string: this.value,
    });
  }
}

export class NumberDimension extends Dimension {
  readonly value: number;
  constructor(name: string, value: number) {
    super(name);
    this.value = value;
  }

  asOtlpKeyValue(): KeyValue {
    const value = new AnyValue({int_value: this.value});
    return new KeyValue({key: this.name, value});
  }

  asGoodmetricsDimension(): goodmetrics.Dimension {
    return new goodmetrics.Dimension({
      number: this.value,
    });
  }
}

export class BooleanDimension extends Dimension {
  readonly value: boolean;
  constructor(name: string, value: boolean) {
    super(name);
    this.value = value;
  }

  asOtlpKeyValue(): KeyValue {
    const value = new AnyValue({bool_value: this.value});
    return new KeyValue({key: this.name, value});
  }

  asGoodmetricsDimension(): goodmetrics.Dimension {
    return new goodmetrics.Dimension({
      boolean: this.value,
    });
  }
}

interface ViewProps {
  metricName: string;
  timestampMillis: number;
  startMilliTime: number;
  dimensions: Map<string, Dimension>;
  measurements: Map<string, number>;
  distributions: Map<string, number>;
}

class View {
  private readonly metricName: string;
  private readonly timestampMillis: number;
  private readonly startMilliTime: number;
  private readonly dimensions: Map<string, Dimension>;
  private readonly measurements: Map<string, number>;
  private readonly distributions: Map<string, number>;
  constructor(props: ViewProps) {
    this.metricName = props.metricName;
    this.timestampMillis = props.timestampMillis;
    this.startMilliTime = props.startMilliTime;
    this.dimensions = props.dimensions;
    this.measurements = props.measurements;
    this.distributions = props.distributions;
  }
}

interface MetricsProps {
  name: string;
  timestampMillis: number;
  startMilliTime: number;
  metricsBehavior?: MetricsBehavior;
}

// We only want to expose these functions to our users, none of the internal otlp bs
export interface Metrics {
  distribution: (name: string, value: number) => void;
  dimension: (dimension: string, value: boolean | number | string) => void;
  measure: (name: string, value: number) => void;
}

export class _Metrics implements Metrics {
  readonly name: string;
  timestampMillis: number;
  readonly startMilliTime: number;
  readonly metricsBehavior: MetricsBehavior;
  readonly metricMeasurements: Map<string, number> = new Map();
  readonly metricDistributions: Map<string, number> = new Map();
  readonly metricDimensions: Map<string, Dimension> = new Map();
  constructor(props: MetricsProps) {
    this.name = props.name;
    this.timestampMillis = props.timestampMillis;
    this.startMilliTime = props.startMilliTime;
    this.metricsBehavior = props.metricsBehavior ?? MetricsBehavior.DEFAULT;
  }

  getView(): View {
    return new View({
      metricName: this.name,
      timestampMillis: this.timestampMillis,
      startMilliTime: this.startMilliTime,
      measurements: this.metricMeasurements,
      dimensions: this.metricDimensions,
      distributions: this.metricDistributions,
    });
  }

  dimension(dimension: string, value: boolean | number | string) {
    if (typeof value === 'boolean') {
      const d = new BooleanDimension(dimension, value);
      this.metricDimensions.set(dimension, d);
    } else if (typeof value === 'number') {
      const d = new NumberDimension(dimension, value);
      this.metricDimensions.set(dimension, d);
    } else if (typeof value === 'string') {
      const d = new StringDimension(dimension, value);
      this.metricDimensions.set(dimension, d);
    }
  }

  measure(name: string, value: number) {
    this.metricMeasurements.set(name, value);
  }

  /**
   * Distributions are positive only.
   * This only records 1 position of a distribution per Metrics lifetime.
   */
  distribution(name: string, value: number) {
    if (value < 0) {
      return;
    }
    this.metricDistributions.set(name, value);
  }

  asOtlpHistogram(otlpDimensions: KeyValue[], value: number): Histogram {
    const bucketValue = bucket(value);
    const explicitBounds: number[] = [];
    const bucketCounts: number[] = [];
    if (0 < bucketValue) {
      // This little humdinger is here so Lightstep can interpret the boundary for the _real_ measurement
      // below. It's similar to the 0 that opentelemetry demands, but different in that it is actually a
      // reasonable ask.
      // Lightstep has an internal representation of histograms & while I don't pretend  to understand
      // how they've implemented them, they told me that they interpret the absence of a lower bounding
      // bucket as an infinite lower bound. That's not consistent with my read of otlp BUT it makes
      // infinitely more sense than imposing an upper infinity bucket upon your protocol.
      // Prometheus is a cataclysm from which there is no redemption: It ruins developers' minds with
      // its broken and much lauded blunders; it shames my profession by its protocol as well as those
      // spawned through its vile influence and disappoints the thoughtful by its existence.
      // But, you know, this particular thing for Lightstep seems fine because there's technical merit.
      explicitBounds.push(bucketBelow(value));
      bucketCounts.push(0);
    }

    explicitBounds.push(bucketValue);
    bucketCounts.push(1);
    bucketCounts.push(0); // otlp go die in a fire
    const dataPoint = new HistogramDataPoint({
      attributes: otlpDimensions,
      start_time_unix_nano: Math.floor(
        (this.timestampMillis - (performance.now() - this.startMilliTime)) *
          1000 *
          1000
      ),
      time_unix_nano: Math.floor(this.timestampMillis * 1000 * 1000),
      count: 1,
      bucket_counts: bucketCounts,
      explicit_bounds: explicitBounds,
    });

    return new Histogram({
      data_points: [dataPoint],
      aggregation_temporality:
        AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA,
    });
  }

  asGoofyOtlpMetricSequence(): Metric[] {
    const otlpDimensions: KeyValue[] = [];
    for (const dimension of this.metricDimensions.values()) {
      otlpDimensions.push(dimension.asOtlpKeyValue());
    }
    const metricsWeAreReturning: Metric[] = [];
    this.metricMeasurements.forEach((value, measurementName) => {
      const m = new Metric({
        name: `${this.name}_${measurementName}`,
        unit: '1',
        gauge: new Gauge({
          data_points: [
            newNumberDataPoint(
              value,
              this.timestampMillis,
              performance.now() - this.startMilliTime,
              otlpDimensions
            ),
          ],
        }),
      });
      metricsWeAreReturning.push(m);
    });

    this.metricDistributions.forEach((value, measurementName) => {
      const m = new Metric({
        name: `${this.name}_${measurementName}`,
        unit: '1',
        histogram: this.asOtlpHistogram(otlpDimensions, value),
      });
      metricsWeAreReturning.push(m);
    });

    return metricsWeAreReturning;
  }

  dimensionPosition(): Set<Dimension> {
    return new Set(Array.from(this.metricDimensions.values()));
  }
}
