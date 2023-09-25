export interface MetricsPipeline<T> {
  consume(): Generator<T, void, void>;
}
