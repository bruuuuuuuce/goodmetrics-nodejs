export interface MetricsPipeline<T> {
  consume(): AsyncGenerator<T, void, void>;
}
