import {MetricsSetups} from '../src/goodmetrics/metricsSetups';
import {Metrics} from '../src/goodmetrics/_Metrics';

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
    lightstepAccessToken: '',
    logError(message: string, error: unknown): void {
      console.error(message, error);
    },
    onSendUnary(metrics: Metrics[]): void {
      console.log('sending unary', metrics);
    },
  });

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
