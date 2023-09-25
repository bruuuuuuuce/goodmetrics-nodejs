import {_Metrics} from '../_Metrics';

export interface MetricsSink {
  emit(metrics: _Metrics): void | Promise<void>;
  close(): void;
}
