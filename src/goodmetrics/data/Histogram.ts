import {bucket, bucketBelow} from '../pipeline/aggregator';
import {Aggregation} from './Aggregation';
import {otlp_common, otlp_metrics} from 'otlp-generated';
import OtlpHistogram = otlp_metrics.opentelemetry.proto.metrics.v1.Histogram;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;
import AggregationTemporality = otlp_metrics.opentelemetry.proto.metrics.v1.AggregationTemporality;
import HistogramDataPoint = otlp_metrics.opentelemetry.proto.metrics.v1.HistogramDataPoint;

interface AsOtlpHistogramProps {
  dimensions: KeyValue[];
  timestampMillis: number;
  aggregationWidthMillis: number;
}

export class Histogram extends Aggregation {
  readonly bucketCounts: Map<number, number>;
  constructor() {
    super();
    this.bucketCounts = new Map<number, number>();
  }

  accumulate(value: number) {
    const _bucket = bucket(value);
    const count = this.bucketCounts.get(_bucket);
    if (count) {
      this.bucketCounts.set(_bucket, count + 1);
    } else {
      this.bucketCounts.set(_bucket, 1);
    }
  }

  asOtlpHistogram(props: AsOtlpHistogramProps): OtlpHistogram {
    const startTimeUnixMilli =
      props.timestampMillis - props.aggregationWidthMillis;
    let count = 0;
    for (const num of this.bucketCounts.values()) {
      count += num;
    }
    const sortedBuckets = [...this.bucketCounts.entries()].sort();
    const otlpBucketCounts: number[] = [];
    const otlpExplicitBounds: number[] = [];
    sortedBuckets.map(([bucket, count]) => {
      const below = bucketBelow(bucket);
      if (0 < below && !this.bucketCounts.has(below)) {
        // And THIS little humdinger is here so Lightstep can interpret the boundary for all non-zero
        // buckets. Lightstep histogram implementation wants non-zero-count ranges to have lower bounds.
        // Not how I've done histograms in the past but :shrug: whatever, looks like the opentelemetry
        // metrics spec is at fault for this one; they refused to improve the specification from
        // openmetrics, which was bastardized in turn by that root of all monitoring evil: Prometheus.
        // Lightstep is a business which must adhere to de-facto standards, so I don't fault them for
        // this; though I would love it if they were to also adopt a good protocol.
        otlpExplicitBounds.push(below);
        otlpBucketCounts.push(0);
      }
      otlpExplicitBounds.push(bucket);
      otlpBucketCounts.push(count);
    });
    otlpBucketCounts.push(0); // because OTLP is _stupid_ and defined histogram format to have an implicit infinity bucket.
    return new OtlpHistogram({
      aggregation_temporality:
        AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA,
      data_points: [
        new HistogramDataPoint({
          attributes: props.dimensions,
          start_time_unix_nano: startTimeUnixMilli * 1000 * 1000,
          time_unix_nano: props.timestampMillis * 1000 * 1000,
          count,
          bucket_counts: otlpBucketCounts,
          explicit_bounds: otlpExplicitBounds,
        }),
      ],
    });
  }
}
