import * as grpc from '@grpc/grpc-js';
import * as http from 'http';
import {otlp_common, otlp_metric_service} from 'otlp-generated';
import ExportMetricsServiceRequest = otlp_metric_service.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;

const {
  UnimplementedMetricsServiceService,
  ExportMetricsServiceResponse,
} = otlp_metric_service.opentelemetry.proto.collector.metrics.v1;

const GRPC_PORT = process.env.GRPC_PORT || '4317';
const HTTP_PORT = process.env.HTTP_PORT || '8080';

interface ReceivedMetric {
  name: string;
  resourceAttributes: Record<string, string | number | boolean | null>;
}

const received: ReceivedMetric[] = [];

function flattenAttributes(
  attributes: KeyValue[]
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
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

function handleExport(
  call: grpc.ServerUnaryCall<
    ExportMetricsServiceRequest,
    InstanceType<typeof ExportMetricsServiceResponse>
  >,
  callback: grpc.sendUnaryData<InstanceType<typeof ExportMetricsServiceResponse>>
): void {
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

httpServer.listen(Number(HTTP_PORT), () => {
  console.log(
    `fake OTLP collector query endpoint listening (HTTP) on :${HTTP_PORT}`
  );
});
