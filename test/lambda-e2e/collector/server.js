'use strict';

const grpc = require('@grpc/grpc-js');
const http = require('http');
const {otlp_metric_service} = require('otlp-generated');

const {
  UnimplementedMetricsServiceService,
  ExportMetricsServiceResponse,
} = otlp_metric_service.opentelemetry.proto.collector.metrics.v1;

const GRPC_PORT = process.env.GRPC_PORT || '4317';
const HTTP_PORT = process.env.HTTP_PORT || '8080';

/** @type {Array<{name: string, resourceAttributes: Record<string, unknown>}>} */
const received = [];

function flattenAttributes(attributes) {
  const out = {};
  for (const attr of attributes) {
    const value = attr.value;
    out[attr.key] =
      value.string_value ??
      value.int_value ??
      value.double_value ??
      value.bool_value ??
      null;
  }
  return out;
}

function handleExport(call, callback) {
  const request = call.request;
  for (const resourceMetrics of request.resource_metrics) {
    const resourceAttributes = flattenAttributes(
      resourceMetrics.resource.attributes
    );
    for (const scopeMetrics of resourceMetrics.scope_metrics) {
      for (const metric of scopeMetrics.metrics) {
        received.push({name: metric.name, resourceAttributes});
      }
    }
  }
  console.log(`received export with ${received.length} total metric(s) so far`);
  callback(null, new ExportMetricsServiceResponse({}));
}

const server = new grpc.Server();
server.addService(UnimplementedMetricsServiceService.definition, {
  Export: handleExport,
});

server.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  err => {
    if (err) {
      console.error('failed to bind gRPC server', err);
      process.exit(1);
    }
    console.log(`fake OTLP collector listening (gRPC) on :${GRPC_PORT}`);
  }
);

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.url === '/received') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(received));
    return;
  }
  res.writeHead(404);
  res.end();
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`fake OTLP collector query endpoint listening (HTTP) on :${HTTP_PORT}`);
});
