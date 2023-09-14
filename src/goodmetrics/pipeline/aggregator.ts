/**
 * Base 10 2-significant-figures bucketing
 */
import {Dimension} from '../_Metrics';
import {otlp_metrics} from 'otlp-generated';
import ScopeMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ScopeMetrics;
import Metric = otlp_metrics.opentelemetry.proto.metrics.v1.Metric;
import {Histogram} from '../data/Histogram';
import {Aggregation} from '../data/Aggregation';
import {StatisticSet} from '../data/StatisticSet';
import {library} from '../data/otlp/library';

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
}
