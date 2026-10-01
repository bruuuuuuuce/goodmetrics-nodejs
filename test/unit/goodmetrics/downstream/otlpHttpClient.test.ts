import * as http from 'http';
import * as net from 'net';
import {AddressInfo} from 'net';
import {otlp_metric_service} from 'otlp-generated';
import {_Metrics, StringDimension} from '@src/goodmetrics/_Metrics';
import {StatisticSet} from '@src/goodmetrics/data/StatisticSet';
import {OtlpHttpClient} from '@src/goodmetrics/downstream/otlpHttpClient';
import {AggregatedBatch} from '@src/goodmetrics/pipeline/aggregator';

const ExportRequest =
  otlp_metric_service.opentelemetry.proto.collector.metrics.v1
    .ExportMetricsServiceRequest;

let server: http.Server | undefined;

async function receive(
  handler: (
    request: http.IncomingMessage,
    body: Buffer,
    response: http.ServerResponse
  ) => void
): Promise<string> {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => handler(request, Buffer.concat(chunks), response));
  });
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1/metrics`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  }
});

function client(
  endpointUrl: string,
  headers?: Record<string, string>,
  timeoutMillis?: number
): OtlpHttpClient {
  return OtlpHttpClient.connect({
    endpointUrl,
    headers,
    timeoutMillis,
    resourceDimensions: new Map([['env', new StringDimension('env', 'prod')]]),
    metricDimensions: new Map(),
  });
}

it('posts unary metrics as OTLP Protobuf with headers and accepts an empty 2xx body', async () => {
  let received = false;
  const endpoint = await receive((request, body, response) => {
    received = true;
    const decoded = ExportRequest.deserializeBinary(body);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/metrics');
    expect(request.headers['content-type']).toBe('application/x-protobuf');
    expect(request.headers['x-test-key']).toBe('secret');
    expect(Number(request.headers['content-length'])).toBe(body.length);
    expect(
      decoded.resource_metrics[0].resource.attributes[0].value.string_value
    ).toBe('prod');
    expect(
      decoded.resource_metrics[0].scope_metrics[0].metrics.map(
        metric => metric.name
      )
    ).toEqual(['orders_count']);
    response.writeHead(204);
    response.end();
  });
  const exporter = client(endpoint, {'x-test-key': 'secret'});
  const metrics = new _Metrics({name: 'orders', timestampMillis: 1000});
  metrics.measure('count', 3);

  await exporter.sendMetricsBatch([metrics]);

  expect(received).toBe(true);
  exporter.close();
});

it('posts preaggregated metrics using the same OTLP encoding', async () => {
  let names: string[] = [];
  const endpoint = await receive((_request, body, response) => {
    const decoded = ExportRequest.deserializeBinary(body);
    names = decoded.resource_metrics[0].scope_metrics[0].metrics.map(
      metric => metric.name
    );
    response.writeHead(200);
    response.end();
  });
  const stats = new StatisticSet();
  stats.accumulate(10);
  const batch = new AggregatedBatch({
    timestampMillis: 1000,
    aggregationWidthMillis: 1000,
    metric: 'orders',
    positions: new Map([
      [
        new Set([new StringDimension('shard', 'a')]),
        new Map([['latency', stats]]),
      ],
    ]),
  });
  const exporter = client(endpoint);

  await exporter.sendPreaggregatedBatch([batch]);

  expect(names).toContain('orders_latency_count');
  exporter.close();
});

it('reports rejected data points in an HTTP 200 partial-success response', async () => {
  const endpoint = await receive((_request, _body, response) => {
    response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
    // ExportMetricsServiceResponse.partial_success.rejected_data_points = 2.
    response.end(Buffer.from([0x0a, 0x02, 0x08, 0x02]));
  });
  const exporter = client(endpoint);

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow(
    /2 rejected data points/
  );
  exporter.close();
});

it('reports a partial-success warning without exposing authenticated response details', async () => {
  const token = 'sensitive-token';
  const warning = `check ${token}`;
  const message = Buffer.from(warning, 'utf8');
  const partial = Buffer.concat([Buffer.from([0x12, message.length]), message]);
  const responseBody = Buffer.concat([
    Buffer.from([0x0a, partial.length]),
    partial,
  ]);
  const endpoint = await receive((_request, _body, response) => {
    response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
    response.end(responseBody);
  });
  const headers = {Authorization: `Bearer ${token}`};
  const exporter = client(endpoint, headers);

  const pending = exporter.sendMetricsBatch([]);
  delete (headers as {Authorization?: string}).Authorization;
  const error: unknown = await pending.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toContain('0 rejected data points');
    expect(error.message).not.toContain(token);
  }
  exporter.close();
});

it('preserves the Grafana Cloud gateway path', async () => {
  let path = '';
  const endpoint = await receive((request, _body, response) => {
    path = request.url ?? '';
    response.writeHead(204);
    response.end();
  });
  const exporter = client(endpoint.replace('/v1/metrics', '/otlp/v1/metrics'));

  await exporter.sendMetricsBatch([]);

  expect(path).toBe('/otlp/v1/metrics');
  exporter.close();
});

it.each([
  'ftp://example.com/v1/metrics',
  'https://example.com/metrics',
  'https://example.com/v1/metrics?token=secret',
  'https://example.com/v1/metrics#fragment',
  'not-a-url',
])('rejects invalid endpoint %s', endpoint => {
  expect(() => client(endpoint)).toThrow();
});

it('rejects non-2xx errors with a bounded response and without configured tokens', async () => {
  const token = 'private-key';
  const endpoint = await receive((_request, _body, response) => {
    response.writeHead(413);
    response.end(`rejected ${token} ${'x'.repeat(2000)}`);
  });
  const exporter = client(endpoint, {'dd-api-key': token});
  const metrics = new _Metrics({name: 'orders', timestampMillis: 1000});

  const error: unknown = await exporter
    .sendMetricsBatch([metrics])
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toContain('413');
    expect(error.message).not.toContain(token);
    expect(error.message.length).toBeLessThan(1200);
  }
  exporter.close();
});

it('does not expose an unencoded token echoed by a server', async () => {
  const token = 'sensitive-token';
  const authorization = `Basic ${Buffer.from(`123:${token}`).toString('base64')}`;
  let receivedAuthorization: string | undefined;
  const endpoint = await receive((request, _body, response) => {
    receivedAuthorization = request.headers.authorization;
    response.writeHead(401);
    response.end(`invalid token ${token}`);
  });
  const headers = {Authorization: authorization};
  const exporter = client(endpoint, headers);

  const pending = exporter.sendMetricsBatch([]);
  delete (headers as {Authorization?: string}).Authorization;
  const error: unknown = await pending.catch((e: unknown) => e);
  expect(receivedAuthorization).toBe(authorization);
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toContain('401');
    expect(error.message).not.toContain(token);
  }
  exporter.close();
});

it('does not expose authenticated response bytes from a malformed HTTP response', async () => {
  const token = 'sensitive-token';
  const malformedServer = net.createServer(socket => {
    socket.once('data', () => {
      socket.end(`HTTP/1.1 200 OK\r\nInvalid Header ${token}\r\n\r\n`);
    });
  });
  await new Promise<void>(resolve =>
    malformedServer.listen(0, '127.0.0.1', resolve)
  );
  const address = malformedServer.address() as AddressInfo;
  const headers = {
    'dd-api-key': token,
  };
  const exporter = client(
    `http://127.0.0.1:${address.port}/v1/metrics`,
    headers
  );

  try {
    const pending = exporter.sendMetricsBatch([]);
    delete (headers as {'dd-api-key'?: string})['dd-api-key'];
    const error: unknown = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(token);
    if (typeof error === 'object' && error !== null) {
      expect('rawPacket' in error).toBe(false);
      expect('cause' in error).toBe(false);
    }
  } finally {
    exporter.close();
    await new Promise<void>(resolve => malformedServer.close(() => resolve()));
  }
});

it('rejects a refused connection', async () => {
  const endpoint = await receive((_request, _body, response) => response.end());
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  server = undefined;
  const exporter = client(endpoint);

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow();
  exporter.close();
});

it('aborts an unresponsive request at the configured timeout', async () => {
  const endpoint = await receive(() => undefined);
  const exporter = client(endpoint, undefined, 25);

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow(/timed out/i);
  exporter.close();
});

it('reports a timeout without exposing authenticated transport errors', async () => {
  const endpoint = await receive(() => undefined);
  const exporter = client(endpoint, {'dd-api-key': 'secret'}, 25);

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow(/timed out/i);
  exporter.close();
});

it('enforces an elapsed deadline while the server keeps sending bytes', async () => {
  let responseClosed = false;
  const endpoint = await receive((_request, _body, response) => {
    response.writeHead(200);
    const interval = setInterval(() => response.write('x'), 5);
    const end = setTimeout(() => response.end(), 150);
    response.on('close', () => {
      responseClosed = true;
      clearInterval(interval);
      clearTimeout(end);
    });
  });
  const exporter = client(endpoint, undefined, 30);

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow(/timed out/i);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(responseClosed).toBe(true);
  exporter.close();
});

it('prevents sends after close', async () => {
  const endpoint = await receive((_request, _body, response) => response.end());
  const exporter = client(endpoint);
  exporter.close();

  await expect(exporter.sendMetricsBatch([])).rejects.toThrow(/closed/i);
});
