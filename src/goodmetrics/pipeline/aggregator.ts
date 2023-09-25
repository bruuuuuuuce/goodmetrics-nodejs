import {otlp_metrics} from 'otlp-generated';
import ScopeMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ScopeMetrics;
import Metric = otlp_metrics.opentelemetry.proto.metrics.v1.Metric;
import {Histogram} from '../data/Histogram';
import {Aggregation} from '../data/Aggregation';
import {StatisticSet} from '../data/StatisticSet';
import {library} from '../data/otlp/library';
import {_Metrics, Dimension} from '../_Metrics';
import {MetricsPipeline} from './metricsPipeline';
import {MetricsSink} from './metricsSink';
import {CancellationToken} from './cancellationToken';
import {goodmetrics} from 'goodmetrics-generated';

type DimensionPosition = Set<Dimension>;

type AggregationMap = Map<string, Aggregation>;
type DimensionPositionMap = Map<DimensionPosition, AggregationMap>;
type MetricsMap = Map<string, DimensionPositionMap>;

export function bucket(value: number): number {
  if (value < 100) return Math.max(0, value);
  const power = Math.log10(value);
  const effectivePower = Math.max(0, power - 1);
  const trashColumn = Math.pow(10, effectivePower);
  const trash = value % trashColumn;
  if (trash < 1) {
    return value;
  } else {
    return value + trashColumn - trash;
  }
}

export function bucketBelow(valueIn: number): number {
  const value = valueIn - 1;
  if (value < 100) return Math.max(0, value);
  const power = Math.log10(value);
  const effectivePower = Math.max(0, power - 0.00001 - 1);
  const trashColumn = Math.pow(10, effectivePower);
  const trash = value % trashColumn;
  return value - trash;
}

/**
 * Base 2 bucketing. This is plain bucketing; no sub-steps, just the next highest base2 power of value.
 */
export function bucketBase2(value: number): number {
  const power = Math.ceil(Math.log2(value));
  return Math.pow(2, power);
}

type MetricPosition = Set<Dimension>;
type MetricPositions = Map<
  /**
   * Dimensions - the position
   */
  MetricPosition,
  /**
   * Measurement name -> aggregated measurement
   * Measurements per position
   */
  Map<string, Aggregation>
>;

interface AggregatedBatchProps {
  timestampMillis: number;
  aggregationWidthMillis: number;
  metric: string;
  positions: MetricPositions;
}

export class AggregatedBatch {
  private readonly timestampMillis: number;
  private readonly aggregationWidthMillis: number;
  private readonly metric: string;
  private readonly positions: MetricPositions;
  constructor(props: AggregatedBatchProps) {
    this.timestampMillis = props.timestampMillis;
    this.metric = props.metric;
    this.aggregationWidthMillis = props.aggregationWidthMillis;
    this.positions = props.positions;
  }

  asOtlpScopeMetrics(): ScopeMetrics {
    return new ScopeMetrics({
      scope: library,
      metrics: this.asGoofyOtlpMetricSequence(),
    });
  }

  asGoodmetrics(): goodmetrics.Datum[] {
    const datums: goodmetrics.Datum[] = [];
    for (const [dimensionPosition, measurementMap] of this.positions) {
      const templateDatum = this.initializeGoodMetricPositionDatum(
        dimensionPosition,
        this.timestampMillis,
        this.metric
      );
      for (const [measurement, aggregation] of measurementMap) {
        templateDatum.measurements.set(
          measurement,
          this.aggregationAsGoodmetricsProto(aggregation)
        );
      }
      datums.push(templateDatum);
    }

    return datums;
  }

  private initializeGoodMetricPositionDatum(
    dimensionPosition: MetricPosition,
    timestampMillis: number,
    name: string
  ): goodmetrics.Datum {
    const dimensionsMap = new Map<string, goodmetrics.Dimension>();
    for (const position of dimensionPosition) {
      dimensionsMap.set(position.name, position.asGoodmetricsDimension());
    }

    return new goodmetrics.Datum({
      unix_nanos: Math.floor(timestampMillis * 1000 * 1000),
      metric: name,
      dimensions: dimensionsMap,
    });
  }

  private asGoofyOtlpMetricSequence(): Metric[] {
    const metricsWeCareAbout: Metric[] = [];
    this.positions.forEach((measurements, metricPositions) => {
      const otlpDimensions = Array.from(metricPositions).map(dimension => {
        return dimension.asOtlpKeyValue();
      });
      measurements.forEach((aggregation, measurementName) => {
        if (aggregation instanceof Histogram) {
          metricsWeCareAbout.push(
            new Metric({
              name: `${this.metric}_${measurementName}`,
              unit: '1',
              histogram: aggregation.asOtlpHistogram({
                dimensions: otlpDimensions,
                aggregationWidthMillis: this.aggregationWidthMillis,
                timestampMillis: this.timestampMillis,
              }),
            })
          );
        } else if (aggregation instanceof StatisticSet) {
          metricsWeCareAbout.push(
            ...aggregation.toOtlp({
              metric: this.metric,
              measurementName: measurementName,
              aggregationWidthMillis: this.aggregationWidthMillis,
              timestampMillis: this.timestampMillis,
              dimensions: otlpDimensions,
            })
          );
        }
      });
    });

    return metricsWeCareAbout;
  }

  private aggregationAsGoodmetricsProto(
    aggregation: Aggregation
  ): goodmetrics.Measurement {
    if (aggregation instanceof Histogram) {
      const buckets = new Map<number, number>();
      for (const [bucket, count] of aggregation.bucketCounts) {
        buckets.set(bucket, count);
      }
      return new goodmetrics.Measurement({
        histogram: new goodmetrics.Histogram({
          buckets,
        }),
      });
    } else if (aggregation instanceof StatisticSet) {
      const aggreValues = aggregation.values();
      return new goodmetrics.Measurement({
        statistic_set: new goodmetrics.StatisticSet({
          samplecount: aggreValues.count,
          samplesum: aggreValues.sum,
          minimum: aggreValues.min,
          maximum: aggreValues.max,
        }),
      });
    } else {
      throw new Error(
        'cannot convert aggregation into a goodmetrics proto, unknown type'
      );
    }
  }
}

type AggregatorProps = {
  aggregationWidthMillis?: number;
};

// export class Aggregator
//   implements MetricsPipeline<AggregatedBatch>, MetricsSink
// {
//   private readonly aggregationWidthMillis: number;
//   private readonly cancellationToken: CancellationToken;
//   private currentBatch: MetricsMap;
//   private lastEmit: number;
//
//   constructor(props: AggregatorProps) {
//     const now = performance.now();
//     this.aggregationWidthMillis = props.aggregationWidthMillis ?? 10 * 1000;
//     this.lastEmit = now - (now % this.aggregationWidthMillis);
//     this.currentBatch = new Map();
//     this.cancellationToken = new CancellationToken();
//   }
//
//   private delay = async (millis: number): Promise<void> => {
//     let timeoutId: NodeJS.Timeout | undefined;
//     try {
//       return await new Promise<void>(resolve => {
//         timeoutId = setTimeout(() => {
//           resolve();
//         }, millis);
//       });
//     } finally {
//       clearTimeout(timeoutId);
//     }
//   };
//
//   async *consume(): AsyncGenerator<AggregatedBatch, void, void> {
//     while (true) {
//       if (this.cancellationToken.isCancelled()) {
//         return;
//       }
//       // epoch time at which we will next emit metrics
//       const nextEmit = this.lastEmit + this.aggregationWidthMillis;
//       // difference between now and when we will next emit metrics, should be negative
//       const timeToNextEmit = performance.now() - nextEmit;
//       this.lastEmit += this.aggregationWidthMillis;
//       if (timeToNextEmit > 0 || this.aggregationWidthMillis < -timeToNextEmit) {
//         // Skip a time column because of sadness.
//         // Resume on the column cadence as best we can.
//         // TODO race with cancellation
//         await this.delay(Math.abs(timeToNextEmit));
//         continue;
//       }
//
//       // TODO race with cancellation
//       await this.delay(-timeToNextEmit);
//       const batch = this.currentBatch;
//       this.currentBatch = new Map();
//
//       for (const [metric, positions] of batch) {
//         if (this.cancellationToken.isCancelled()) {
//           return;
//         }
//         yield new AggregatedBatch({
//           timestampMillis: this.lastEmit,
//           aggregationWidthMillis: this.aggregationWidthMillis,
//           metric: metric,
//           positions: positions,
//         });
//       }
//     }
//   }
//
//   emit(metrics: _Metrics): void {
//     const position = metrics.dimensionPosition();
//     let metricPositions = this.currentBatch.get(metrics.name);
//     if (!metricPositions) {
//       metricPositions = new Map();
//       this.currentBatch.set(metrics.name, metricPositions);
//     }
//
//     // Simple measurements are statistic_sets
//     for (const [name, value] of metrics.metricMeasurements) {
//       if (!metricPositions.has(position)) {
//         metricPositions.set(position, new Map());
//       }
//       if (!metricPositions.get(position)!.has(name)) {
//         metricPositions.get(position)!.set(name, new StatisticSet({}));
//       }
//       const ss = metricPositions.get(position)!.get(name)!;
//       ss.accumulate(value);
//     }
//
//     for (const [name, value] of metrics.metricDistributions) {
//       if (!metricPositions.has(position)) {
//         metricPositions.set(position, new Map());
//       }
//       if (!metricPositions.get(position)!.has(name)) {
//         metricPositions.get(position)!.set(name, new Histogram());
//       }
//       const histogram = metricPositions.get(position)!.get(name)!;
//       histogram.accumulate(value);
//     }
//   }
//
//   close(): void {
//     this.cancellationToken.cancel();
//   }
// }
