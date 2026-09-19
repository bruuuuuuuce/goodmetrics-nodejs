import {MetricsSetups, SecurityMode} from 'goodmetrics-nodejs';

export const handler = async (): Promise<{
  statusCode: number;
  body: string;
}> => {
  const metricsFactory =
    MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda({
      lightstepAccessToken: 'unused-in-this-test',
      lightstepUrl: process.env.COLLECTOR_HOST || 'collector',
      lightstepPort: Number(process.env.COLLECTOR_PORT || '4317'),
      lightstepConnectionSecurityMode: SecurityMode.Plaintext,
      resourceDimensions: new Map(),
      doLogSuccess: true,
      logError(message: string, error: unknown): void {
        console.error(message, error);
      },
    });

  await metricsFactory.record({name: 'lambda_e2e_test_metric'}, metrics => {
    metrics.measure('invocations', 1);
  });

  return {statusCode: 200, body: 'ok'};
};
