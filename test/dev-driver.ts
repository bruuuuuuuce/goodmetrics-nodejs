import {MetricsSetups, Metrics} from '../src';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const main = async () => {
  const metrics =
    MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda({
      resourceDimensions: new Map(),
      lightstepAccessToken: process.env.LIGHTSTEP_ACCESS_TOKEN || '',
      logError(message: string, error: unknown): void {
        console.error(message, error);
      },
      onSendUnary(metrics: Metrics[]): void {
        console.log('sending unary', metrics);
      },
    });

  await metrics.record(
    {
      name: 'integrations',
    },
    async metrics => {
      metrics.measure('runs', 1);
      await delay(335);
    }
  );
};

void main().finally();
