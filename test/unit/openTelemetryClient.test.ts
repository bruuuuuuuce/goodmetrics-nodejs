import {
  OpenTelemetryClient,
  SecurityMode,
} from '../../src/goodmetrics/downstream/openTelemetryClient';
import {_Metrics, StringDimension} from '../../src/goodmetrics/_Metrics';
import {AggregatedBatch} from '../../src/goodmetrics/pipeline/aggregator';
import {StatisticSet} from '../../src/goodmetrics/data/StatisticSet';
import {otlp_metric_service} from 'otlp-generated';

type ExportRequest = InstanceType<
  typeof otlp_metric_service.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest
>;
type ExportFn = (
  request: ExportRequest,
  options: unknown,
  callback: (err: Error | null) => void
) => void;

function underlyingClient(client: OpenTelemetryClient): {
  Export: ExportFn;
  close: () => void;
} {
  return (client as unknown as {client: {Export: ExportFn; close: () => void}})
    .client;
}

function connectWithStubbedTransport(
  resourceDimensions: Map<string, StringDimension> = new Map()
): {
  client: OpenTelemetryClient;
  requests: ExportRequest[];
} {
  const client = OpenTelemetryClient.connect({
    sillyOtlpHostname: '127.0.0.1',
    port: 0,
    securityMode: SecurityMode.Plaintext,
    resourceDimensions,
    metricDimensions: new Map<string, StringDimension>(),
    interceptors: [],
  });
  const requests: ExportRequest[] = [];
  underlyingClient(client).Export = (request, _options, callback) => {
    requests.push(request);
    callback(null);
  };
  return {client, requests};
}

describe('OpenTelemetryClient.sendMetricsBatch', () => {
  it('converts a batch of _Metrics into a single ExportMetricsServiceRequest', async () => {
    const {client, requests} = connectWithStubbedTransport();

    const metrics = new _Metrics({name: 'my_metric', timestampMillis: 1});
    metrics.measure('count', 3);

    await client.sendMetricsBatch([metrics]);

    expect(requests).toHaveLength(1);
    const [resourceMetrics] = requests[0].resource_metrics;
    const [scopeMetrics] = resourceMetrics.scope_metrics;
    expect(scopeMetrics.metrics.map(m => m.name)).toEqual(['my_metric_count']);
  });

  it('attaches configured resource dimensions to the exported resource', async () => {
    const {client, requests} = connectWithStubbedTransport(
      new Map([['env', new StringDimension('env', 'prod')]])
    );

    await client.sendMetricsBatch([
      new _Metrics({name: 'my_metric', timestampMillis: 1}),
    ]);

    const attributes = requests[0].resource_metrics[0].resource.attributes;
    expect(attributes.find(a => a.key === 'env')?.value.string_value).toBe(
      'prod'
    );
  });

  it('rejects when the underlying gRPC call reports an error', async () => {
    const {client} = connectWithStubbedTransport();
    underlyingClient(client).Export = (_request, _options, callback) => {
      callback(new Error('server unavailable'));
    };

    await expect(
      client.sendMetricsBatch([
        new _Metrics({name: 'my_metric', timestampMillis: 1}),
      ])
    ).rejects.toThrow('server unavailable');
  });
});

describe('OpenTelemetryClient.sendPreaggregatedBatch', () => {
  it('converts a batch of AggregatedBatch into a single ExportMetricsServiceRequest', async () => {
    const {client, requests} = connectWithStubbedTransport();

    const stats = new StatisticSet({});
    stats.accumulate(10);
    const position = new Set([new StringDimension('shard', 'a')]);
    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'agg_metric',
      positions: new Map([[position, new Map([['latency', stats]])]]),
    });

    await client.sendPreaggregatedBatch([batch]);

    expect(requests).toHaveLength(1);
    const [resourceMetrics] = requests[0].resource_metrics;
    expect(resourceMetrics.scope_metrics).toHaveLength(1);
  });
});

describe('OpenTelemetryClient.close', () => {
  it('closes the underlying gRPC client', () => {
    const {client} = connectWithStubbedTransport();
    const underlying = underlyingClient(client);
    underlying.close = jest.fn();

    client.close();

    expect(underlying.close).toHaveBeenCalled();
  });
});
