import {MetricsSetups, Metrics} from '../src';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const main = async () => {
  const metrics = MetricsSetups.lightstepNativeOtlp({
    aggregationWidthMillis: 10 * 1000,
    lightstepAccessToken: process.env.LIGHTSTEP_ACCESS_TOKEN || '',
    logError(message: string, error: unknown): void {
      console.error(message, error);
    },
    onSendUnary(metrics: Metrics[]): void {
      console.log('sending unary', metrics);
    },
  });

  const goodmetrics = MetricsSetups.goodMetrics();
  await goodmetrics.unaryMetricsFactory.record({name: 'unary'}, metrics => {
    metrics.dimension('is_local', true);
    metrics.measure('runs', 1);
  });
  await goodmetrics.preaggregatedMetricsFactory.record(
    {name: 'preaggregated'},
    metrics => {
      metrics.measure('w00t', 1);
    }
  );

  await delay(8000);
  await metrics.unaryMetricsFactory.record(
    {
      name: 'test',
    },
    metrics => {
      metrics.measure('runs', 1);
    }
  );

  await delay(15000);
};

main().finally();
