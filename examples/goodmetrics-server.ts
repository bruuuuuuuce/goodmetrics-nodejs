/**
 * A metrics setup using the bespoke `goodmetrics` protocol (https://github.com/kvc0/goodmetrics)
 * instead of OTLP, talking to a local goodmetrics server. Like `server-batched-otlp.ts`, this is
 * meant for a long-running process: metrics are buffered and flushed periodically in the
 * background rather than sent one at a time.
 *
 * Run with a goodmetrics server listening on localhost:9573 (the default), then:
 *   npx ts-node --prefer-ts-exts examples/goodmetrics-server.ts
 */
import {MetricsSetups} from '../src';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
};

const main = async () => {
  const metrics = MetricsSetups.goodMetrics({
    host: 'localhost',
    port: 9573,
    aggregationWidthMillis: 10 * 1000,
  });

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
};

void main().finally();
