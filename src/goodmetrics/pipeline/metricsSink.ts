import {_Metrics} from '../_Metrics';

export interface MetricsSink {
  emit(metrics: _Metrics): Promise<void>;
}
