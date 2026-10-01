import {_Metrics} from '../_Metrics';
import {AggregatedBatch} from '../pipeline/aggregator';

export interface OtlpMetricsExporter {
  sendMetricsBatch(batch: _Metrics[]): Promise<void>;
  sendPreaggregatedBatch(batch: AggregatedBatch[]): Promise<void>;
  close(): void;
}
