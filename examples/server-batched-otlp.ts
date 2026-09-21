/**
 * A metrics setup for a long-running process (e.g. a webserver), as opposed to the
 * short-lived-process examples. `record()` here doesn't send metrics immediately - they're
 * buffered and flushed periodically in the background (batched for `unaryMetricsFactory`,
 * aggregated-then-batched for `preaggregatedMetricsFactory`), which is far cheaper than sending
 * one network call per recorded metric.
 *
 * Run with:
 *   LIGHTSTEP_ACCESS_TOKEN=<your token> npx ts-node --prefer-ts-exts examples/server-batched-otlp.ts
 */
import {Dimension, MetricsSetups} from '../src';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
};

const main = async () => {
  const metrics = MetricsSetups.lightstepNativeOtlp({
    lightstepAccessToken: process.env.LIGHTSTEP_ACCESS_TOKEN || '',
    resourceDimensions: new Map<string, Dimension>(),
    aggregationWidthMillis: 10 * 1000,
    unaryBatchSizeMaxMetricsCount: 1000,
    unaryBatchMaxAgeSeconds: 10,
    logError(message: string, error: unknown): void {
      console.error(message, error);
    },
  });

  // Simulate a server handling several requests over time. Each one records both a raw
  // (unary) metric and a preaggregated one - use whichever fits a given metric's cardinality.
  for (let i = 0; i < 5; i++) {
    await metrics.unaryMetricsFactory.record(
      {name: 'request'},
      async metrics => {
        metrics.dimension('route', '/orders');
        metrics.measure('runs', 1);
        await delay(20);
      }
    );

    await metrics.preaggregatedMetricsFactory.record(
      {name: 'request_latency'},
      metrics => {
        metrics.dimension('route', '/orders');
      }
    );

    await delay(200);
  }

  // The batchers flush on their own timer in the background (see unaryBatchMaxAgeSeconds
  // above), so the process stays alive for up to that long after main() returns in order to
  // send the final, still-filling batch.
};

void main().finally();
