import {StatisticSet} from '../../src/goodmetrics/data/StatisticSet';

describe('StatisticSet', () => {
  it('tracks min/max/sum/count as values are accumulated', () => {
    const stats = new StatisticSet({});
    stats.accumulate(10);
    stats.accumulate(30);
    stats.accumulate(20);

    expect(stats.values()).toEqual({min: 10, max: 30, sum: 60, count: 3});
  });

  it('addNum() returns a new StatisticSet reflecting the added value', () => {
    const stats = new StatisticSet({min: 5, max: 5, sum: 5, count: 1});
    const updated = stats.addNum(15);

    expect(updated.values()).toEqual({min: 5, max: 15, sum: 20, count: 2});
    // original is untouched
    expect(stats.values()).toEqual({min: 5, max: 5, sum: 5, count: 1});
  });

  it('addSS() merges two StatisticSets', () => {
    const a = new StatisticSet({min: 1, max: 10, sum: 11, count: 2});
    const b = new StatisticSet({min: 5, max: 20, sum: 25, count: 2});

    expect(a.addSS(b).values()).toEqual({min: 1, max: 20, sum: 36, count: 4});
  });

  it('toOtlp() emits one Metric per statistic component, named metric_measurement_component', () => {
    const stats = new StatisticSet({});
    stats.accumulate(10);
    stats.accumulate(20);

    const metrics = stats.toOtlp({
      metric: 'my_metric',
      measurementName: 'latency',
      timestampMillis: 1000,
      aggregationWidthMillis: 100,
      dimensions: [],
    });

    expect(metrics.map(m => m.name)).toEqual([
      'my_metric_latency_min',
      'my_metric_latency_max',
      'my_metric_latency_count',
      'my_metric_latency_sum',
    ]);
    const values = metrics.map(m => m.sum.data_points[0].as_int);
    expect(values).toEqual([10, 20, 2, 30]);
  });
});
