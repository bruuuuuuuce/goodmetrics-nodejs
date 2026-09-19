import {GoodmetricsClient} from '../../src/goodmetrics/downstream/goodmetricsClient';
import {SecurityMode} from '../../src/goodmetrics/downstream/openTelemetryClient';
import {_Metrics, StringDimension} from '../../src/goodmetrics/_Metrics';
import {AggregatedBatch} from '../../src/goodmetrics/pipeline/aggregator';
import {StatisticSet} from '../../src/goodmetrics/data/StatisticSet';
import {goodmetrics} from 'goodmetrics-generated';

type MetricsRequest = InstanceType<typeof goodmetrics.MetricsRequest>;
type SendMetricsFn = (
  request: MetricsRequest,
  options: unknown,
  callback: (err: Error | null) => void
) => void;

/**
 * Unlike test/integration/goodmetricsClient.integration.test.ts (which exercises a real gRPC
 * round trip), these tests stub out the underlying generated grpc client to isolate and quickly
 * exercise GoodmetricsClient's own conversion logic and edge cases.
 */
function stubSendMetrics(client: GoodmetricsClient, impl: SendMetricsFn): void {
  (
    client as unknown as {client: {SendMetrics: SendMetricsFn}}
  ).client.SendMetrics = impl;
}

function connectWithStubbedTransport(
  sharedDimensions?: Map<string, StringDimension>
): {client: GoodmetricsClient; requests: MetricsRequest[]} {
  const client = GoodmetricsClient.connect({
    hostname: '127.0.0.1',
    port: 0,
    securityMode: SecurityMode.Plaintext,
    sharedDimensions,
  });
  const requests: MetricsRequest[] = [];
  stubSendMetrics(client, (request, _options, callback) => {
    requests.push(request);
    callback(null);
  });
  return {client, requests};
}

describe('GoodmetricsClient.sendMetricsBatch', () => {
  it('converts dimensions and integer/float measurements into a MetricsRequest', async () => {
    const {client, requests} = connectWithStubbedTransport();

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.dimension('region', 'us-east-1');
    metrics.measure('count', 3);
    metrics.measure('ratio', 0.5);

    await client.sendMetricsBatch([metrics]);

    expect(requests).toHaveLength(1);
    const [datum] = requests[0].metrics;
    expect(datum.metric).toBe('my_metric');
    expect(datum.dimensions.get('region')?.string).toBe('us-east-1');
    expect(datum.measurements.get('count')?.i64).toBe(3);
    expect(datum.measurements.get('ratio')?.f64).toBeCloseTo(0.5);
  });

  it('floors distribution measurements to i64', async () => {
    const {client, requests} = connectWithStubbedTransport();

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.distribution('latency', 12.9);

    await client.sendMetricsBatch([metrics]);

    expect(requests[0].metrics[0].measurements.get('latency')?.i64).toBe(12);
  });

  it('includes configured shared dimensions on every request', async () => {
    const {client, requests} = connectWithStubbedTransport(
      new Map([['env', new StringDimension('env', 'prod')]])
    );

    await client.sendMetricsBatch([
      new _Metrics({name: 'my_metric', timestampMillis: 1}),
    ]);

    expect(requests[0].shared_dimensions.get('env')?.string).toBe('prod');
  });

  it('rejects when the underlying gRPC call reports an error', async () => {
    const {client} = connectWithStubbedTransport();
    stubSendMetrics(client, (_request, _options, callback) => {
      callback(new Error('server unavailable'));
    });

    await expect(
      client.sendMetricsBatch([
        new _Metrics({name: 'my_metric', timestampMillis: 1}),
      ])
    ).rejects.toThrow('server unavailable');
  });
});

describe('GoodmetricsClient.sendPreaggregatedMetrics', () => {
  it('flattens each AggregatedBatch into Datums on the MetricsRequest', async () => {
    const {client, requests} = connectWithStubbedTransport();

    const stats = new StatisticSet({});
    stats.accumulate(10);
    stats.accumulate(30);
    const position = new Set([new StringDimension('shard', 'a')]);
    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'agg_metric',
      positions: new Map([[position, new Map([['latency', stats]])]]),
    });

    await client.sendPreaggregatedMetrics([batch]);

    expect(requests).toHaveLength(1);
    const [datum] = requests[0].metrics;
    expect(datum.metric).toBe('agg_metric');
    expect(datum.dimensions.get('shard')?.string).toBe('a');
    expect(datum.measurements.get('latency')?.statistic_set?.samplecount).toBe(
      2
    );
  });
});
