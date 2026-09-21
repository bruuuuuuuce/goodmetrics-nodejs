/**
 * A metrics setup for a short-lived process (e.g. an AWS Lambda) sending metrics to
 * Lightstep. Since the process may be frozen/killed as soon as the handler returns, this
 * sends metrics synchronously as part of `record()` instead of buffering them for a later
 * batch send.
 *
 * Run with:
 *   LIGHTSTEP_ACCESS_TOKEN=<your token> npx ts-node --prefer-ts-exts examples/lambda-lightstep.ts
 */
import {Dimension, Metrics, MetricsSetups} from '../src';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
};

const main = async () => {
  const metrics =
    MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda({
      lightstepAccessToken: process.env.LIGHTSTEP_ACCESS_TOKEN || '',
      resourceDimensions: new Map<string, Dimension>(),
      logError(message: string, error: unknown): void {
        console.error(message, error);
      },
      onSendUnary(metrics: Metrics[]): void {
        console.log('sending unary', metrics);
      },
    });

  await metrics.record({name: 'handler_invocation'}, async metrics => {
    metrics.dimension('cold_start', false);
    // ... do the actual work of the handler ...
    await delay(50);
    metrics.measure('runs', 1);
  });
};

void main().finally();
