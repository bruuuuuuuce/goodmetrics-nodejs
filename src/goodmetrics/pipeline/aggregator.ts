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

/**
 * A stable, content-based key for a DimensionPosition. Dimension positions are
 * freshly-allocated Sets on every _Metrics.dimensionPosition() call, so they
 * can't be used as Map keys directly (Map keys compare by reference, not
 * contents) without every emit() landing in its own bucket.
 */
function dimensionValueKey(dimension: Dimension): string {
  return Buffer.from(dimension.asOtlpKeyValue().serializeBinary()).toString(
    'hex'
  );
}

function positionKey(position: DimensionPosition): string {
  return Array.from(position, dimensionValueKey).sort().join('\u0001');
}

type AggregationMap = Map<string, Aggregation>;
interface DimensionPositionEntry {
  position: DimensionPosition;
  aggregations: AggregationMap;
}
type DimensionPositionMap = Map<string, DimensionPositionEntry>;
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
  metricDimensions?: Map<string, Dimension>;
};

export function validateAggregationWidthMillis(
  aggregationWidthMillis: number
): void {
  if (
    !Number.isFinite(aggregationWidthMillis) ||
    aggregationWidthMillis < 1 ||
    aggregationWidthMillis > 2_147_483_647
  ) {
    throw new RangeError(
      'aggregationWidthMillis must be between 1 and 2147483647 milliseconds'
    );
  }
}

export class Aggregator
  implements MetricsPipeline<AggregatedBatch>, MetricsSink
{
  private readonly aggregationWidthMillis: number;
  private readonly metricDimensions: Map<string, Dimension>;
  private readonly cancellationToken: CancellationToken;
  private readonly pendingDelays = new Set<() => void>();
  private currentBatch: MetricsMap;
  private lastEmit: number;

  constructor(props: AggregatorProps) {
    const now = Date.now();
    const aggregationWidthMillis = props.aggregationWidthMillis ?? 10 * 1000;
    validateAggregationWidthMillis(aggregationWidthMillis);
    this.aggregationWidthMillis = aggregationWidthMillis;
    this.metricDimensions = new Map();
    for (const dimension of props.metricDimensions?.values() ?? []) {
      this.metricDimensions.set(dimension.name, dimension);
    }
    this.lastEmit = now - (now % this.aggregationWidthMillis);
    this.currentBatch = new Map();
    this.cancellationToken = new CancellationToken();
  }

  private delay = (millis: number): Promise<void> => {
    if (this.cancellationToken.isCancelled()) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const complete = (): void => {
        clearTimeout(timeoutId);
        this.pendingDelays.delete(complete);
        resolve();
      };
      const timeoutId = setTimeout(complete, millis);
      this.pendingDelays.add(complete);
    });
  };

  async *consume(): AsyncGenerator<AggregatedBatch, void, void> {
    while (true) {
      if (this.cancellationToken.isCancelled()) {
        return;
      }
      const previousEmit = this.lastEmit;
      const now = Date.now();
      const nextEmit = Math.max(
        previousEmit + this.aggregationWidthMillis,
        Math.ceil(now / this.aggregationWidthMillis) *
          this.aggregationWidthMillis
      );
      // A slow downstream send may pause consume() across several windows.
      // Flush on the next aligned boundary and account for the full interval.
      await this.delay(Math.max(0, nextEmit - now));
      if (this.cancellationToken.isCancelled()) {
        return;
      }
      this.lastEmit = nextEmit;
      const batch = this.currentBatch;
      this.currentBatch = new Map();

      for (const [metric, positions] of batch) {
        if (this.cancellationToken.isCancelled()) {
          return;
        }
        const flattenedPositions: MetricPositions = new Map();
        for (const entry of positions.values()) {
          flattenedPositions.set(entry.position, entry.aggregations);
        }
        yield new AggregatedBatch({
          timestampMillis: this.lastEmit,
          aggregationWidthMillis: nextEmit - previousEmit,
          metric: metric,
          positions: flattenedPositions,
        });
      }
    }
  }

  emit(metrics: _Metrics): void {
    const positionByName = new Map(this.metricDimensions);
    for (const dimension of metrics.dimensionPosition()) {
      positionByName.set(dimension.name, dimension);
    }
    const position = new Set(positionByName.values());
    const key = positionKey(position);
    let metricPositions = this.currentBatch.get(metrics.name);
    if (!metricPositions) {
      metricPositions = new Map();
      this.currentBatch.set(metrics.name, metricPositions);
    }

    let entry = metricPositions.get(key);
    if (!entry) {
      entry = {position, aggregations: new Map()};
      metricPositions.set(key, entry);
    }
    const aggregationMap = entry.aggregations;

    // Simple measurements are statistic_sets
    for (const [name, value] of metrics.metricMeasurements) {
      let aggregation = aggregationMap.get(name);
      if (!aggregation) {
        aggregation = new StatisticSet({});
        aggregationMap.set(name, aggregation);
      }
      aggregation.accumulate(value);
    }

    for (const [name, value] of metrics.metricDistributions) {
      let aggregation = aggregationMap.get(name);
      if (!aggregation) {
        aggregation = new Histogram();
        aggregationMap.set(name, aggregation);
      }
      aggregation.accumulate(value);
    }
  }

  close(): void {
    this.cancellationToken.cancel();
    for (const complete of this.pendingDelays) {
      complete();
    }
  }
}
