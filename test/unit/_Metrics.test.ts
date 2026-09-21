import {
  _Metrics,
  BooleanDimension,
  MetricsBehavior,
  NumberDimension,
  StringDimension,
} from '../../src/goodmetrics/_Metrics';

describe('_Metrics', () => {
  it('records dimensions of each supported type via dimension()', () => {
    const metrics = new _Metrics({name: 'test', timestampMillis: 1});
    metrics.dimension('str', 'hello');
    metrics.dimension('num', 42);
    metrics.dimension('bool', true);

    expect(metrics.metricDimensions.get('str')).toBeInstanceOf(StringDimension);
    expect(metrics.metricDimensions.get('num')).toBeInstanceOf(NumberDimension);
    expect(metrics.metricDimensions.get('bool')).toBeInstanceOf(
      BooleanDimension
    );
  });

  it('records measurements via measure()', () => {
    const metrics = new _Metrics({name: 'test', timestampMillis: 1});
    metrics.measure('count', 7);
    metrics.measure('count', 9); // last write wins, no accumulation at this layer

    expect(metrics.metricMeasurements.get('count')).toBe(9);
  });

  it('records positive distributions and silently drops negative ones', () => {
    const metrics = new _Metrics({name: 'test', timestampMillis: 1});
    metrics.distribution('latency', 12.5);
    metrics.distribution('bogus', -1);

    expect(metrics.metricDistributions.get('latency')).toBe(12.5);
    expect(metrics.metricDistributions.has('bogus')).toBe(false);
  });

  it('defaults to MetricsBehavior.DEFAULT when none is provided', () => {
    const metrics = new _Metrics({name: 'test', timestampMillis: 1});
    expect(metrics.metricsBehavior).toBe(MetricsBehavior.DEFAULT);
  });

  it('honors an explicit metricsBehavior', () => {
    const metrics = new _Metrics({
      name: 'test',
      timestampMillis: 1,
      metricsBehavior: MetricsBehavior.NO_TOTALTIME,
    });
    expect(metrics.metricsBehavior).toBe(MetricsBehavior.NO_TOTALTIME);
  });

  it('dimensionPosition() reflects the current set of dimensions', () => {
    const metrics = new _Metrics({name: 'test', timestampMillis: 1});
    metrics.dimension('a', '1');
    metrics.dimension('b', '2');

    const position = metrics.dimensionPosition();
    expect(position.size).toBe(2);
  });

  it('asGoofyOtlpMetricSequence() produces one Metric per measurement and per distribution', () => {
    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.dimension('region', 'us-east-1');
    metrics.measure('runs', 3);
    metrics.distribution('latency', 5);

    const sequence = metrics.asGoofyOtlpMetricSequence();
    const names = sequence.map(m => m.name);

    expect(names).toEqual(
      expect.arrayContaining(['my_metric_runs', 'my_metric_latency'])
    );
    expect(sequence).toHaveLength(2);

    const runsMetric = sequence.find(m => m.name === 'my_metric_runs');
    const attributes = runsMetric?.gauge?.data_points[0].attributes;
    expect(attributes?.find(a => a.key === 'region')?.value.string_value).toBe(
      'us-east-1'
    );
  });
});
