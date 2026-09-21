import {
  OpenTelemetryClient,
  SecurityMode,
} from '../../src/goodmetrics/downstream/openTelemetryClient';
import {_Metrics, StringDimension} from '../../src/goodmetrics/_Metrics';
import {AggregatedBatch} from '../../src/goodmetrics/pipeline/aggregator';
import {StatisticSet} from '../../src/goodmetrics/data/StatisticSet';
import {otlp_metric_service, otlp_metrics} from 'otlp-generated';

type ExportRequest = InstanceType<
  typeof otlp_metric_service.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest
>;
type ResourceMetrics = InstanceType<
  typeof otlp_metrics.opentelemetry.proto.metrics.v1.ResourceMetrics
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
  resourceDimensions: Map<string, StringDimension> = new Map(),
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void
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
    logRawPayload,
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

  it('invokes the configured logRawPayload hook with the raw ResourceMetrics', async () => {
    const logRawPayload = jest.fn();
    const {client} = connectWithStubbedTransport(new Map(), logRawPayload);

    await client.sendMetricsBatch([
      new _Metrics({name: 'my_metric', timestampMillis: 1}),
    ]);

    expect(logRawPayload).toHaveBeenCalledTimes(1);
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

  it('rejects when the underlying gRPC call reports an error', async () => {
    const {client} = connectWithStubbedTransport();
    underlyingClient(client).Export = (_request, _options, callback) => {
      callback(new Error('server unavailable'));
    };

    const stats = new StatisticSet({});
    stats.accumulate(10);
    const position = new Set([new StringDimension('shard', 'a')]);
    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 10_000,
      metric: 'agg_metric',
      positions: new Map([[position, new Map([['latency', stats]])]]),
    });

    await expect(client.sendPreaggregatedBatch([batch])).rejects.toThrow(
      'server unavailable'
    );
  });

  it('invokes the configured logRawPayload hook with the raw ResourceMetrics', async () => {
    const logRawPayload = jest.fn();
    const {client} = connectWithStubbedTransport(new Map(), logRawPayload);

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

    expect(logRawPayload).toHaveBeenCalledTimes(1);
  });
});

describe('OpenTelemetryClient.connect', () => {
  it('creates SSL channel credentials when securityMode is Tls (or omitted)', () => {
    const client = OpenTelemetryClient.connect({
      sillyOtlpHostname: '127.0.0.1',
      port: 0,
      securityMode: SecurityMode.Tls,
      resourceDimensions: new Map(),
      metricDimensions: new Map(),
      interceptors: [],
    });

    expect(client).toBeInstanceOf(OpenTelemetryClient);
    client.close();
  });

  it('defaults sillyOtlpHostname and port when omitted', () => {
    const client = OpenTelemetryClient.connect({
      securityMode: SecurityMode.Plaintext,
      resourceDimensions: new Map(),
      metricDimensions: new Map(),
      interceptors: [],
    });

    expect(client).toBeInstanceOf(OpenTelemetryClient);
    client.close();
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
