import {
  Aggregator,
  AggregatedBatch,
  bucket,
  bucketBase2,
  bucketBelow,
} from '@src/goodmetrics/pipeline/aggregator';
import {
  _Metrics,
  Dimension,
  NumberDimension,
  StringDimension,
} from '@src/goodmetrics/_Metrics';
import {StatisticSet} from '@src/goodmetrics/data/StatisticSet';
import {Histogram} from '@src/goodmetrics/data/Histogram';

class CustomDimension extends Dimension {
  constructor(
    name: string,
    private readonly value: string
  ) {
    super(name);
  }

  asOtlpKeyValue(): ReturnType<Dimension['asOtlpKeyValue']> {
    return new StringDimension(this.name, this.value).asOtlpKeyValue();
  }

  asGoodmetricsDimension(): ReturnType<Dimension['asGoodmetricsDimension']> {
    return new StringDimension(this.name, this.value).asGoodmetricsDimension();
  }
}

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
  it.each([0, -1, NaN, Infinity, -Infinity, 0.5, 2_147_483_648])(
    'rejects unsupported aggregation width %s',
    aggregationWidthMillis => {
      expect(() => new Aggregator({aggregationWidthMillis})).toThrow(
        /aggregationWidthMillis/
      );
    }
  );

  it.each([1, 2_147_483_647])(
    'accepts supported aggregation width %s',
    aggregationWidthMillis => {
      expect(() => new Aggregator({aggregationWidthMillis})).not.toThrow();
    }
  );

  it('combines records with equivalent effective shared dimensions', async () => {
    const aggregator = new Aggregator({
      aggregationWidthMillis: 20,
      metricDimensions: new Map([
        ['region', new StringDimension('region', 'west')],
      ]),
    });
    const implicit = new _Metrics({name: 'orders', timestampMillis: 1});
    implicit.measure('count', 1);
    const explicit = new _Metrics({name: 'orders', timestampMillis: 1});
    explicit.dimension('region', 'west');
    explicit.measure('count', 1);
    const override = new _Metrics({name: 'orders', timestampMillis: 1});
    override.dimension('region', 'east');
    override.measure('count', 1);
    aggregator.emit(implicit);
    aggregator.emit(explicit);
    aggregator.emit(override);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected an aggregated batch');
    }
    const datums = value.asGoodmetrics();
    expect(datums).toHaveLength(2);
    const west = datums.find(
      datum => datum.dimensions.get('region')?.string === 'west'
    );
    const east = datums.find(
      datum => datum.dimensions.get('region')?.string === 'east'
    );
    expect(west?.measurements.get('count')?.statistic_set?.samplecount).toBe(2);
    expect(east?.measurements.get('count')?.statistic_set?.samplecount).toBe(1);
    aggregator.close();
  });

  it('groups custom shared dimensions by their encoded value', async () => {
    const aggregator = new Aggregator({
      aggregationWidthMillis: 20,
      metricDimensions: new Map([
        ['region', new CustomDimension('region', 'west')],
      ]),
    });
    const implicit = new _Metrics({name: 'orders', timestampMillis: 1});
    implicit.measure('count', 1);
    const explicit = new _Metrics({name: 'orders', timestampMillis: 1});
    explicit.dimension('region', 'west');
    explicit.measure('count', 2);
    aggregator.emit(implicit);
    aggregator.emit(explicit);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected an aggregated batch');
    }
    const datums = value.asGoodmetrics();
    expect(datums).toHaveLength(1);
    expect(datums[0].dimensions.get('region')?.string).toBe('west');
    expect(
      datums[0].measurements.get('count')?.statistic_set?.samplecount
    ).toBe(2);
    aggregator.close();
  });

  it('flushes accumulated metrics promptly after the consumer was paused', async () => {
    jest.useFakeTimers({now: 1000});
    const aggregator = new Aggregator({aggregationWidthMillis: 20});
    const batches = aggregator.consume();
    try {
      const first = new _Metrics({name: 'first', timestampMillis: 1000});
      first.measure('count', 1);
      aggregator.emit(first);
      const firstBatch = batches.next();
      await jest.advanceTimersByTimeAsync(20);
      expect((await firstBatch).value).toBeInstanceOf(AggregatedBatch);

      await jest.advanceTimersByTimeAsync(100);
      const second = new _Metrics({name: 'second', timestampMillis: 1120});
      second.measure('count', 1);
      aggregator.emit(second);
      const nextBatch = batches.next();
      let settled = false;
      void nextBatch.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(25);

      expect(settled).toBe(true);
      const result = await nextBatch;
      expect(result.value).toBeInstanceOf(AggregatedBatch);
      if (result.value instanceof AggregatedBatch) {
        expect(result.value.asGoodmetrics()[0].metric).toBe('second');
      }
    } finally {
      aggregator.close();
      await jest.runOnlyPendingTimersAsync();
      jest.useRealTimers();
    }
  });

  it('aggregates emitted metrics and yields a batch once the aggregation width elapses', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.dimension('shard', 'a');
    metrics.measure('count', 5);
    aggregator.emit(metrics);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected consume() to yield an AggregatedBatch');
    }

    const [datum] = value.asGoodmetrics();
    expect(datum.metric).toBe('my_metric');
    expect(datum.dimensions.get('shard')?.string).toBe('a');
    expect(datum.measurements.get('count')?.statistic_set?.samplecount).toBe(1);

    aggregator.close();
  });

  it('stops consume() once closed', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});
    aggregator.close();

    const {done} = await aggregator.consume().next();
    expect(done).toBe(true);
  });

  it('clears a long pending aggregation timer when closed', async () => {
    jest.useFakeTimers({now: 1000});
    const aggregator = new Aggregator({
      aggregationWidthMillis: 2_147_483_647,
    });
    try {
      const pending = aggregator.consume().next();
      expect(jest.getTimerCount()).toBe(1);

      aggregator.close();
      await jest.advanceTimersByTimeAsync(0);

      expect(jest.getTimerCount()).toBe(0);
      expect((await pending).done).toBe(true);
    } finally {
      aggregator.close();
      jest.useRealTimers();
    }
  });

  it('aggregates distribution measurements into a Histogram across repeated emits', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.dimension('shardNumber', 1);
    metrics.distribution('latency', 5);
    aggregator.emit(metrics);
    aggregator.emit(metrics);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected consume() to yield an AggregatedBatch');
    }

    const [datum] = value.asGoodmetrics();
    expect(datum.dimensions.get('shardNumber')?.number).toBe(1);
    const buckets = datum.measurements.get('latency')?.histogram?.buckets;
    expect(buckets?.get(5)).toBe(2);

    aggregator.close();
  });

  it('aggregates metrics keyed by boolean dimensions', async () => {
    const aggregator = new Aggregator({aggregationWidthMillis: 20});

    const metrics = new _Metrics({name: 'flagged_metric', timestampMillis: 1});
    metrics.dimension('enabled', true);
    metrics.measure('count', 1);
    aggregator.emit(metrics);

    const {value} = await aggregator.consume().next();
    if (!(value instanceof AggregatedBatch)) {
      throw new Error('expected consume() to yield an AggregatedBatch');
    }

    const [datum] = value.asGoodmetrics();
    expect(datum.dimensions.get('enabled')?.boolean).toBe(true);

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
