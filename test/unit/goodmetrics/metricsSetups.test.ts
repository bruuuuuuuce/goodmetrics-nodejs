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
  method?: string;
  headers: http.IncomingHttpHeaders;
  names: string[];
  resourceAttributes: {key: string; value: string}[];
  metricAttributes: {key: string; value: string}[];
}

let server: http.Server | undefined;
const factories: MetricsFactory[] = [];

async function receiver(
  received: Received[],
  reply?: (response: http.ServerResponse) => void
): Promise<string> {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const decoded = ExportRequest.deserializeBinary(Buffer.concat(chunks));
      received.push({
        method: request.method,
        headers: request.headers,
        names: decoded.resource_metrics.flatMap(resource =>
          resource.scope_metrics.flatMap(scope =>
            scope.metrics.map(metric => metric.name)
          )
        ),
        resourceAttributes: decoded.resource_metrics.flatMap(resource =>
          resource.resource.attributes.map(attribute => ({
            key: attribute.key,
            value: attribute.value.string_value,
          }))
        ),
        metricAttributes: decoded.resource_metrics.flatMap(resource =>
          resource.scope_metrics.flatMap(scope =>
            scope.metrics.flatMap(metric =>
              metric.has_gauge
                ? metric.gauge.data_points.flatMap(point =>
                    point.attributes.map(attribute => ({
                      key: attribute.key,
                      value: attribute.value.string_value,
                    }))
                  )
                : []
            )
          )
        ),
      });
      if (reply) {
        reply(response);
      } else {
        response.writeHead(200);
        response.end();
      }
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

it('waits for the Lambda HTTP export and sends configured headers and dimensions', async () => {
  const received: Received[] = [];
  let requestArrived: (() => void) | undefined;
  const arrived = new Promise<void>(resolve => {
    requestArrived = resolve;
  });
  let releaseResponse: (() => void) | undefined;
  const endpointUrl = await receiver(received, response => {
    releaseResponse = () => {
      response.writeHead(204);
      response.end();
    };
    requestArrived?.();
  });
  const factory = MetricsSetups.otlpHttpForLambda({
    endpointUrl,
    headers: {'x-test-key': 'secret'},
    resourceDimensions: new Map([
      ['service', new StringDimension('service', 'checkout')],
    ]),
    metricDimensions: [new StringDimension('region', 'west')],
    logError: jest.fn(),
  });
  factories.push(factory);

  let settled = false;
  const recording = factory
    .record({name: 'orders'}, metrics => metrics.measure('count', 1))
    .then(() => {
      settled = true;
    });
  await arrived;
  expect(settled).toBe(false);
  expect(received).toHaveLength(1);
  expect(received[0].method).toBe('POST');
  expect(received[0].headers['x-test-key']).toBe('secret');
  expect(received[0].names).toContain('orders_count');
  expect(received[0].resourceAttributes).toEqual([
    {key: 'service', value: 'checkout'},
  ]);
  expect(received[0].metricAttributes).toContainEqual({
    key: 'region',
    value: 'west',
  });
  releaseResponse?.();
  await recording;
  expect(settled).toBe(true);
});

it('logs a failed Lambda HTTP export', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received, response => {
    response.writeHead(503);
    response.end('unavailable');
  });
  const logged: {message: string; error: unknown}[] = [];
  const factory = MetricsSetups.otlpHttpForLambda({
    endpointUrl,
    resourceDimensions: new Map(),
    logError: (message, error) => logged.push({message, error}),
  });
  factories.push(factory);

  await factory.record({name: 'orders'}, metrics =>
    metrics.measure('count', 1)
  );

  expect(received).toHaveLength(1);
  expect(logged).toHaveLength(1);
  expect(logged[0].message).toBe('error while sending blocking metrics');
  const error = logged[0].error;
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toContain('status 503');
  }
});

it('sends Datadog API key with a blocking metric export', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received);
  const logError = jest.fn();
  const factory = MetricsSetups.datadogOtlpHttpForLambda({
    endpointUrl,
    apiKey: 'dd-secret',
    resourceDimensions: new Map<string, Dimension>(),
    logError,
  });
  factories.push(factory);

  await factory.record({name: 'orders'}, metrics =>
    metrics.measure('count', 1)
  );

  expect(received).toHaveLength(1);
  expect(received[0].headers['dd-api-key']).toBe('dd-secret');
  expect(received[0].names).toContain('orders_count');
  expect(logError).not.toHaveBeenCalled();
});

it('sends Datadog API key and array resource dimensions with a batched export', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received);
  const configured = MetricsSetups.datadogOtlpHttp({
    endpointUrl,
    apiKey: 'dd-secret',
    resourceDimensions: [new StringDimension('service.name', 'checkout')],
    logError: jest.fn(),
    unaryBatchSizeMaxMetricsCount: 1,
  });
  factories.push(
    configured.unaryMetricsFactory,
    configured.preaggregatedMetricsFactory
  );

  await configured.unaryMetricsFactory.record({name: 'orders'}, metrics =>
    metrics.measure('count', 1)
  );
  const deadline = Date.now() + 2000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  expect(received).toHaveLength(1);
  expect(received[0].method).toBe('POST');
  expect(received[0].headers['dd-api-key']).toBe('dd-secret');
  expect(received[0].names).toContain('orders_count');
  expect(received[0].resourceAttributes).toContainEqual({
    key: 'service.name',
    value: 'checkout',
  });
});

it('sends Grafana Basic auth and array resource dimensions', async () => {
  const received: Received[] = [];
  const endpointUrl = await receiver(received);
  const factory = MetricsSetups.grafanaCloudOtlpHttpForLambda({
    endpointUrl,
    instanceId: '123',
    accessPolicyToken: 'tokén:part',
    resourceDimensions: [new StringDimension('service.name', 'checkout')],
    logError: jest.fn(),
  });
  factories.push(factory);

  await factory.record({name: 'orders'}, metrics =>
    metrics.measure('count', 1)
  );

  expect(received).toHaveLength(1);
  expect(received[0].headers.authorization).toBe(
    `Basic ${Buffer.from('123:tokén:part', 'utf8').toString('base64')}`
  );
  expect(received[0].names).toContain('orders_count');
  expect(received[0].resourceAttributes).toContainEqual({
    key: 'service.name',
    value: 'checkout',
  });
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
    metricDimensions: [new StringDimension('region', 'west')],
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
