/**
 * Send metrics directly to Datadog's OTLP/HTTP metrics intake.
 *
 * Run with:
 *   DD_API_KEY=<api key> \
 *   DATADOG_OTLP_METRICS_ENDPOINT=https://otlp.datadoghq.com/v1/metrics \
 *     npx ts-node --prefer-ts-exts examples/datadog-cloud.ts
 *
 * Choose the endpoint for your Datadog site; the URL above is for US1.
 */
import {MetricsSetups, StringDimension} from '../src';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const metrics = MetricsSetups.datadogOtlpHttpForLambda({
    endpointUrl: requiredEnv('DATADOG_OTLP_METRICS_ENDPOINT'),
    apiKey: requiredEnv('DD_API_KEY'),
    resourceDimensions: new Map([
      [
        'service.name',
        new StringDimension('service.name', 'goodmetrics-example'),
      ],
    ]),
    logError(message: string, error: unknown): void {
      console.error(message, error);
    },
  });

  await metrics.record({name: 'handler_invocation'}, record => {
    record.measure('runs', 1);
    record.dimension('result', 'success');
  });
}

void main();
