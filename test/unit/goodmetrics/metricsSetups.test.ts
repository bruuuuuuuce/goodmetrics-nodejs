import * as http from 'http';
import {AddressInfo} from 'net';
import {otlp_metric_service} from 'otlp-generated';
import {Dimension, MetricsSetups, MetricsFactory, StringDimension} from '@src';
import {MetricsSink} from '@src/goodmetrics/pipeline/metricsSink';
import {OtlpHttpClient} from '@src/goodmetrics/downstream/otlpHttpClient';
import {GoodmetricsClient} from '@src/goodmetrics/downstream/goodmetricsClient';

const ExportRequest =
  otlp_metric_service.opentelemetry.proto.collector.metrics.v1
    .ExportMetricsServiceRequest;

interface Received {
  headers: http.IncomingHttpHeaders;
  names: string[];
}

let server: http.Server | undefined;
const factories: MetricsFactory[] = [];

async function receiver(received: Received[]): Promise<string> {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const decoded = ExportRequest.deserializeBinary(Buffer.concat(chunks));
      received.push({
        headers: request.headers,
        names: decoded.resource_metrics.flatMap(resource =>
          resource.scope_metrics.flatMap(scope =>
            scope.metrics.map(metric => metric.name)
          )
        ),
      });
      response.writeHead(200);
      response.end();
    });
  });
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/metrics`;
}

afterEach(async () => {
  for (const factory of factories) {
    (factory as unknown as {metricsSink: MetricsSink}).metricsSink.close();
  }
  factories.length = 0;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  }
});

it('uses the existing unary and preaggregated factories for batched HTTP', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received);
  const configured = MetricsSetups.otlpHttp({
    endpointUrl,
    resourceDimensions: new Map<string, Dimension>(),
    logError: jest.fn(),
    unaryBatchSizeMaxMetricsCount: 1,
    unaryBatchMaxAgeSeconds: 0.01,
    preaggregatedBatchMaxMetricsCount: 1,
    preaggregatedBatchMaxAgeSeconds: 0.01,
    aggregationWidthMillis: 20,
  });
  factories.push(
    configured.unaryMetricsFactory,
    configured.preaggregatedMetricsFactory
  );

  await configured.unaryMetricsFactory.record({name: 'orders'}, metrics =>
    metrics.measure('count', 1)
  );
  await configured.preaggregatedMetricsFactory.record(
    {name: 'latency'},
    metrics => metrics.measure('ms', 10)
  );
  const deadline = Date.now() + 2000;
  while (
    !received
      .flatMap(exported => exported.names)
      .includes('latency_ms_count') &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  const names = received.flatMap(exported => exported.names);
  expect(names).toContain('orders_count');
  expect(names).toContain('latency_ms_count');
});

it('groups equivalent shared dimensions before preaggregated HTTP export', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received);
  const configured = MetricsSetups.otlpHttp({
    endpointUrl,
    resourceDimensions: new Map<string, Dimension>(),
    metricDimensions: new Map([
      ['region', new StringDimension('region', 'west')],
    ]),
    aggregationWidthMillis: 20,
    preaggregatedBatchMaxMetricsCount: 1,
    preaggregatedBatchMaxAgeSeconds: 0.01,
    logError: jest.fn(),
  });
  factories.push(
    configured.unaryMetricsFactory,
    configured.preaggregatedMetricsFactory
  );

  await configured.preaggregatedMetricsFactory.record(
    {name: 'orders'},
    metrics => metrics.measure('count', 1)
  );
  await configured.preaggregatedMetricsFactory.record(
    {name: 'orders'},
    metrics => {
      metrics.dimension('region', 'west');
      metrics.measure('count', 1);
    }
  );
  const deadline = Date.now() + 2000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  const exportedCounts = received
    .flatMap(item => item.names)
    .filter(name => name === 'orders_count_count');
  expect(exportedCounts).toHaveLength(1);
});

it('rejects an invalid preaggregated batch size before creating an exporter', () => {
  const connect = jest
    .spyOn(OtlpHttpClient, 'connect')
    .mockImplementation(() => {
      throw new Error('exporter created');
    });
  try {
    expect(() =>
      MetricsSetups.otlpHttp({
        endpointUrl: 'https://example.com/v1/metrics',
        resourceDimensions: new Map(),
        preaggregatedBatchMaxMetricsCount: 0,
        logError: jest.fn(),
      })
    ).toThrow(/preaggregatedBatchMaxMetricsCount/);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

it.each([
  'unaryBatchMaxAgeSeconds',
  'preaggregatedBatchMaxAgeSeconds',
] as const)('rejects invalid HTTP %s before creating an exporter', ageName => {
  const connect = jest
    .spyOn(OtlpHttpClient, 'connect')
    .mockImplementation(() => {
      throw new Error('exporter created');
    });
  try {
    expect(() =>
      MetricsSetups.otlpHttp({
        endpointUrl: 'https://example.com/v1/metrics',
        resourceDimensions: new Map(),
        [ageName]: -1,
        logError: jest.fn(),
      })
    ).toThrow(new RegExp(ageName));
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

it.each([
  'unaryBatchMaxAgeSeconds',
  'preaggregatedBatchMaxAgeSeconds',
] as const)(
  'rejects invalid native OTLP %s before creating a client',
  ageName => {
    const connect = jest
      .spyOn(MetricsSetups, 'opentelemetryClient')
      .mockImplementation(() => {
        throw new Error('client created');
      });
    try {
      expect(() =>
        MetricsSetups.lightstepNativeOtlp({
          lightstepAccessToken: 'token',
          aggregationWidthMillis: 1000,
          [ageName]: -1,
          logError: jest.fn(),
        })
      ).toThrow(new RegExp(ageName));
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  }
);

it('rejects invalid HTTP aggregation width before creating an exporter', () => {
  const connect = jest
    .spyOn(OtlpHttpClient, 'connect')
    .mockImplementation(() => {
      throw new Error('exporter created');
    });
  try {
    expect(() =>
      MetricsSetups.otlpHttp({
        endpointUrl: 'https://example.com/v1/metrics',
        resourceDimensions: new Map(),
        aggregationWidthMillis: 0,
        logError: jest.fn(),
      })
    ).toThrow(/aggregationWidthMillis/);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

it('rejects invalid native OTLP aggregation width before creating a client', () => {
  const connect = jest
    .spyOn(MetricsSetups, 'opentelemetryClient')
    .mockImplementation(() => {
      throw new Error('client created');
    });
  try {
    expect(() =>
      MetricsSetups.lightstepNativeOtlp({
        lightstepAccessToken: 'token',
        aggregationWidthMillis: 0,
        logError: jest.fn(),
      })
    ).toThrow(/aggregationWidthMillis/);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

it('rejects invalid Goodmetrics aggregation width before creating a client', () => {
  const connect = jest
    .spyOn(GoodmetricsClient, 'connect')
    .mockImplementation(() => {
      throw new Error('client created');
    });
  try {
    expect(() =>
      MetricsSetups.goodMetrics({aggregationWidthMillis: 0})
    ).toThrow(/aggregationWidthMillis/);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});
