import {Aggregation} from './Aggregation';
import {otlp_common, otlp_metrics} from 'otlp-generated';
import Metric = otlp_metrics.opentelemetry.proto.metrics.v1.Metric;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;
import Sum = otlp_metrics.opentelemetry.proto.metrics.v1.Sum;
import AggregationTemporality = otlp_metrics.opentelemetry.proto.metrics.v1.AggregationTemporality;
import {newNumberDataPoint} from './otlp/numbersDataPoint';

interface StatisticSetDataPointProps {
  metricName: string;
  measurementName: string;
  statisticSetComponent: string;
  value: number;
  timestampMillis: number;
  aggregationWidthMillis: number;
  dimensions: KeyValue[];
}

interface ToOtlpProps {
  metric: string;
  measurementName: string;
  timestampMillis: number;
  aggregationWidthMillis: number;
  dimensions: KeyValue[];
}

interface Props {
  min?: number;
  max?: number;
  sum?: number;
  count?: number;
}

export class StatisticSet extends Aggregation {
  private min: number;
  private max: number;
  private sum: number;
  private count: number;
  constructor(props?: Props) {
    super();
    this.min = props?.min ?? Number.MAX_VALUE;
    this.max = props?.max ?? Number.MIN_VALUE;
    this.sum = props?.sum ?? 0;
    this.count = props?.count ?? 0;
  }

  addSS(other: StatisticSet): StatisticSet {
    return new StatisticSet({
      max: Math.max(this.max, other.max),
      min: Math.min(this.min, other.min),
      sum: this.sum + other.sum,
      count: this.count + other.count,
    });
  }

  addNum(num: number): StatisticSet {
    return new StatisticSet({
      max: Math.max(this.max, num),
      min: Math.min(this.min, num),
      sum: this.sum + num,
      count: this.count + 1,
    });
  }

  values() {
    return {
      min: this.min,
      max: this.max,
      count: this.count,
      sum: this.sum,
    };
  }

  private statisticSetDataPoint(props: StatisticSetDataPointProps): Metric {
    return new Metric({
      name: `${props.metricName}_${props.measurementName}_${props.statisticSetComponent}`,
      unit: '1',
      sum: new Sum({
        is_monotonic: false,
        aggregation_temporality:
          AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA,
        data_points: [
          newNumberDataPoint(
            props.value,
            props.timestampMillis,
            props.aggregationWidthMillis,
            props.dimensions
          ),
        ],
      }),
    });
  }

  accumulate(value: number): void {
    this.max = Math.max(value, this.max);
    this.min = Math.min(value, this.min);
    this.sum = this.sum + value;
    this.count = this.count + 1;
  }

  toOtlp(props: ToOtlpProps): Metric[] {
    return [
      this.statisticSetDataPoint({
        measurementName: props.measurementName,
        statisticSetComponent: 'min',
        value: this.min,
        metricName: props.metric,
        dimensions: props.dimensions,
        aggregationWidthMillis: props.aggregationWidthMillis,
        timestampMillis: props.timestampMillis,
      }),
      this.statisticSetDataPoint({
        measurementName: props.measurementName,
        statisticSetComponent: 'max',
        value: this.max,
        metricName: props.metric,
        dimensions: props.dimensions,
        aggregationWidthMillis: props.aggregationWidthMillis,
        timestampMillis: props.timestampMillis,
      }),
      this.statisticSetDataPoint({
        measurementName: props.measurementName,
        statisticSetComponent: 'count',
        value: this.count,
        metricName: props.metric,
        dimensions: props.dimensions,
        aggregationWidthMillis: props.aggregationWidthMillis,
        timestampMillis: props.timestampMillis,
      }),
      this.statisticSetDataPoint({
        measurementName: props.measurementName,
        statisticSetComponent: 'sum',
        value: this.sum,
        metricName: props.metric,
        dimensions: props.dimensions,
        aggregationWidthMillis: props.aggregationWidthMillis,
        timestampMillis: props.timestampMillis,
      }),
    ];
  }
}
