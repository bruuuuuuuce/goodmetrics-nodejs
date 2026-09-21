import {
  MetricsFactory,
  TimestampAt,
  TotaltimeType,
} from '../../src/goodmetrics/metricsFactory';
import {
  _Metrics,
  MetricsBehavior,
  Metrics,
} from '../../src/goodmetrics/_Metrics';
import {MetricsSink} from '../../src/goodmetrics/pipeline/metricsSink';

function capturingSink(): MetricsSink & {emitted: _Metrics[]} {
  const emitted: _Metrics[] = [];
  return {
    emitted,
    emit(metrics: _Metrics) {
      emitted.push(metrics);
    },
    close() {},
  };
}

describe('MetricsFactory', () => {
  it('passes a Metrics object to the block and returns its result', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.None,
    });

    const result = await factory.record({name: 'op'}, metrics => {
      metrics.measure('runs', 1);
      return 'done';
    });

    expect(result).toBe('done');
    expect(sink.emitted).toHaveLength(1);
    expect(sink.emitted[0].metricMeasurements.get('runs')).toBe(1);
  });

  it('emits even when the block throws, and rethrows the original error', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.None,
    });

    await expect(
      factory.record({name: 'op'}, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(sink.emitted).toHaveLength(1);
  });

  it('records totaltime as a distribution when configured for DistributionMilliseconds', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });

    await factory.record({name: 'op'}, () => undefined);

    expect(sink.emitted[0].metricDistributions.has('totaltime')).toBe(true);
    expect(sink.emitted[0].metricMeasurements.has('totaltime')).toBe(false);
  });

  it('records totaltime as a measurement when configured for MeasurementMilliseconds', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.MeasurementMilliseconds,
    });

    await factory.record({name: 'op'}, () => undefined);

    expect(sink.emitted[0].metricMeasurements.has('totaltime')).toBe(true);
    expect(sink.emitted[0].metricDistributions.has('totaltime')).toBe(false);
  });

  it('records no totaltime at all when configured for None', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.None,
    });

    await factory.record({name: 'op'}, () => undefined);

    expect(sink.emitted[0].metricDistributions.has('totaltime')).toBe(false);
    expect(sink.emitted[0].metricMeasurements.has('totaltime')).toBe(false);
  });

  it('skips totaltime entirely when the metric uses NO_TOTALTIME behavior, regardless of totalTimeType', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });

    await factory.recordWithBehavior(
      {name: 'op', behavior: MetricsBehavior.NO_TOTALTIME},
      () => undefined
    );

    expect(sink.emitted[0].metricDistributions.has('totaltime')).toBe(false);
  });

  it('stamps the metric timestamp at call-time for TimestampAt.End', async () => {
    const sink = capturingSink();
    const factory = new MetricsFactory({
      metricsSink: sink,
      totalTimeType: TotaltimeType.None,
    });

    const before = Date.now();
    await factory.record(
      {name: 'op', stampAt: TimestampAt.End},
      (metrics: Metrics) => {
        // timestampMillis is only finalized on emit, not observable mid-block for End
        expect(metrics).toBeDefined();
      }
    );
    const after = Date.now();

    expect(sink.emitted[0].timestampMillis).toBeGreaterThanOrEqual(before);
    expect(sink.emitted[0].timestampMillis).toBeLessThanOrEqual(after);
  });

  describe('logging', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each(['debug', 'info', 'error'] as const)(
      'logs finalization details via console.debug when logLevel is %s',
      async logLevel => {
        const debugSpy = jest
          .spyOn(console, 'debug')
          .mockImplementation(() => undefined);
        const sink = capturingSink();
        const factory = new MetricsFactory({
          metricsSink: sink,
          totalTimeType: TotaltimeType.None,
          logLevel,
        });

        await factory.record({name: 'op'}, () => undefined);

        expect(debugSpy).toHaveBeenCalled();
      }
    );

    it('does not log anything when logLevel is omitted (defaults to none)', async () => {
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => undefined);
      const sink = capturingSink();
      const factory = new MetricsFactory({
        metricsSink: sink,
        totalTimeType: TotaltimeType.None,
      });

      await factory.record({name: 'op'}, () => undefined);

      expect(debugSpy).not.toHaveBeenCalled();
    });
  });
});
