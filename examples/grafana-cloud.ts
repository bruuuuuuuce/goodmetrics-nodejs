/**
 * Send metrics directly to your Grafana Cloud OTLP/HTTP gateway.
 *
 * Run with your stack's OTLP metrics URL, instance ID, and access policy token:
 *   GRAFANA_CLOUD_OTLP_METRICS_ENDPOINT=https://<stack-otlp-endpoint>/otlp/v1/metrics \
 *   GRAFANA_CLOUD_OTLP_INSTANCE_ID=<instance id> \
 *   GRAFANA_CLOUD_ACCESS_POLICY_TOKEN=<token> \
 *     npx ts-node --prefer-ts-exts examples/grafana-cloud.ts
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
  const metrics = MetricsSetups.grafanaCloudOtlpHttpForLambda({
    endpointUrl: requiredEnv('GRAFANA_CLOUD_OTLP_METRICS_ENDPOINT'),
    instanceId: requiredEnv('GRAFANA_CLOUD_OTLP_INSTANCE_ID'),
    accessPolicyToken: requiredEnv('GRAFANA_CLOUD_ACCESS_POLICY_TOKEN'),
    resourceDimensions: [
      new StringDimension('service.name', 'goodmetrics-example'),
    ],
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
