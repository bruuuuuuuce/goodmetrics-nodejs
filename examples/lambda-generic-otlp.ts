/**
 * Same short-lived-process pattern as `lambda-lightstep.ts`, but pointed at any OTLP-compliant
 * metrics backend instead of Lightstep specifically - for example a Datadog Agent's OTLP gRPC
 * receiver (https://docs.datadoghq.com/opentelemetry/setup/), or the Datadog exporter of an
 * OpenTelemetry Collector.
 *
 * NOTE: `rawNativeOtlpButItSendsMetricsUponRecordingForLambda` always connects over TLS - it
 * doesn't expose a `securityMode` option. That's fine for a backend fronted by TLS (Datadog's
 * intake endpoints, most collector deployments behind a load balancer), but a bare local Agent's
 * OTLP receiver is usually plaintext. For that case, use
 * `MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda` instead (despite the
 * name, it works with any OTLP backend) and pass `lightstepConnectionSecurityMode:
 * SecurityMode.Plaintext`; the `lightstep-access-token` header it always sends is harmless and
 * ignored by non-Lightstep backends.
 *
 * Run with:
 *   OTLP_INGEST_URL=<host> OTLP_INGEST_PORT=<port> OTLP_ACCESS_TOKEN=<token> \
 *     npx ts-node --prefer-ts-exts examples/lambda-generic-otlp.ts
 */
import {Dimension, Metrics, MetricsSetups} from '../src';

const main = async () => {
  const metrics =
    MetricsSetups.rawNativeOtlpButItSendsMetricsUponRecordingForLambda({
      accessToken: process.env.OTLP_ACCESS_TOKEN || '',
      authHeaderName: process.env.OTLP_AUTH_HEADER_NAME || 'api-key',
      ingestUrl: process.env.OTLP_INGEST_URL || 'localhost',
      ingestPort: Number(process.env.OTLP_INGEST_PORT) || 4317,
      resourceDimensions: new Map<string, Dimension>(),
      sharedDimensions: new Map<string, Dimension>(),
      logError(message: string, error: unknown): void {
        console.error(message, error);
      },
      onSendUnary(metrics: Metrics[]): void {
        console.log('sending unary', metrics);
      },
    });

  await metrics.record({name: 'handler_invocation'}, metrics => {
    metrics.dimension('cold_start', false);
    metrics.measure('runs', 1);
  });
};

void main().finally();
