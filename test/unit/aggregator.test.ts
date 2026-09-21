import {
  Aggregator,
  AggregatedBatch,
  bucket,
  bucketBase2,
  bucketBelow,
} from '../../src/goodmetrics/pipeline/aggregator';
import {_Metrics, NumberDimension} from '../../src/goodmetrics/_Metrics';
import {StatisticSet} from '../../src/goodmetrics/data/StatisticSet';
import {Histogram} from '../../src/goodmetrics/data/Histogram';

describe('bucket()', () => {
  it('clamps negative values to 0', () => {
    expect(bucket(-5)).toBe(0);
  });

  it('passes values under 100 through unchanged', () => {
    expect(bucket(50)).toBe(50);
  });

  it('roughly preserves magnitude for larger values', () => {
    expect(bucket(12345)).toBeCloseTo(12345, 0);
  });

  it('returns the value unchanged when it lands exactly on a trash-column boundary', () => {
    expect(bucket(1000)).toBe(1000);
  });
});

describe('bucketBelow()', () => {
  it('passes values under 100 through as value - 1', () => {
    expect(bucketBelow(50)).toBe(49);
  });

  it('returns a value strictly less than the input for larger values', () => {
    expect(bucketBelow(150)).toBeLessThan(150);
  });
});

describe('bucketBase2()', () => {
  it('rounds up to the next power of two', () => {
    expect(bucketBase2(5)).toBe(8);
    expect(bucketBase2(9)).toBe(16);
  });

  it('leaves an exact power of two unchanged', () => {
    expect(bucketBase2(8)).toBe(8);
  });
});

describe('AggregatedBatch', () => {
  it('converts accumulated StatisticSet measurements into goodmetrics Datums', () => {
    const position = new Set([new NumberDimension('shard', 1)]);
    const stats = new StatisticSet({});
    stats.accumulate(10);
    stats.accumulate(20);

    const positions = new Map([
      [
        position,
        new Map<string, StatisticSet | Histogram>([['latency', stats]]),
      ],
    ]);

    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'my_metric',
      positions,
    });

    const [datum] = batch.asGoodmetrics();
    expect(datum.metric).toBe('my_metric');
    expect(datum.dimensions.get('shard')?.number).toBe(1);

    const measurement = datum.measurements.get('latency');
    expect(measurement?.statistic_set?.minimum).toBe(10);
    expect(measurement?.statistic_set?.maximum).toBe(20);
    expect(measurement?.statistic_set?.samplecount).toBe(2);
    expect(measurement?.statistic_set?.samplesum).toBe(30);
  });

  it('converts accumulated Histogram measurements into goodmetrics Datums', () => {
    const position = new Set<NumberDimension>();
    const histogram = new Histogram();
    histogram.accumulate(5);
    histogram.accumulate(5);

    const positions = new Map([
      [
        position,
        new Map<string, StatisticSet | Histogram>(
          ['distribution'].map(k => [k, histogram])
        ),
      ],
    ]);

    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'my_metric',
      positions,
    });

    const [datum] = batch.asGoodmetrics();
    const buckets = datum.measurements.get('distribution')?.histogram?.buckets;
    expect(buckets?.get(5)).toBe(2);
  });

  it('converts accumulated Histogram measurements into an OTLP histogram metric', () => {
    const position = new Set<NumberDimension>();
    const histogram = new Histogram();
    histogram.accumulate(5);
    histogram.accumulate(5);

    const positions = new Map([
      [
        position,
        new Map<string, StatisticSet | Histogram>([
          ['distribution', histogram],
        ]),
      ],
    ]);

    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'my_metric',
      positions,
    });

    const scopeMetrics = batch.asOtlpScopeMetrics();
    expect(scopeMetrics.metrics.map(m => m.name)).toEqual([
      'my_metric_distribution',
    ]);
    expect(scopeMetrics.metrics[0].histogram).toBeDefined();
  });

  it('throws when asked to convert an aggregation of an unrecognized type', () => {
    const position = new Set<NumberDimension>();
    const positions = new Map([
      [
        position,
        new Map<string, StatisticSet | Histogram>([
          ['mystery', {} as StatisticSet],
        ]),
      ],
    ]);

    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'my_metric',
      positions,
    });

    expect(() => batch.asGoodmetrics()).toThrow(
      'cannot convert aggregation into a goodmetrics proto, unknown type'
    );
  });
});

describe('Aggregator', () => {
  it('aggregates emitted metrics and yields a batch once the aggregation width elapses', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.measure('count', 5);
    aggregator.emit(metrics);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected consume() to yield an AggregatedBatch');
    }

    const [datum] = value.asGoodmetrics();
    expect(datum.metric).toBe('my_metric');
    expect(datum.measurements.get('count')?.statistic_set?.samplecount).toBe(1);

    aggregator.close();
  });

  it('stops consume() once closed', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});
    aggregator.close();

    const {done} = await aggregator.consume().next();
    expect(done).toBe(true);
  });

  it('aggregates distribution measurements into a Histogram across repeated emits', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.distribution('latency', 5);
    aggregator.emit(metrics);
    aggregator.emit(metrics);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected consume() to yield an AggregatedBatch');
    }

    const [datum] = value.asGoodmetrics();
    const buckets = datum.measurements.get('latency')?.histogram?.buckets;
    expect(buckets?.get(5)).toBe(2);

    aggregator.close();
  });

  it('stops mid-batch when cancelled between yields', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const first = new _Metrics({name: 'metric_a', timestampMillis: 1});
    first.measure('count', 1);
    aggregator.emit(first);

    const second = new _Metrics({name: 'metric_b', timestampMillis: 1});
    second.measure('count', 1);
    aggregator.emit(second);

    const gen = aggregator.consume();
    const firstResult = await gen.next();
    expect(firstResult.done).toBe(false);

    aggregator.close();

    const secondResult = await gen.next();
    expect(secondResult.done).toBe(true);
  });
});
