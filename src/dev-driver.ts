import {
  Header,
  HeaderInterceptorProvider,
} from './goodmetrics/downstream/grpc/headerInterceptor';
import {OpenTelemetryClient} from './goodmetrics/downstream/openTelemetryClient';
import {MetricsSetups} from './goodmetrics/metricsSetups';
import {_Metrics, Metrics} from './goodmetrics/_Metrics';
import {TimestampAt} from './goodmetrics/metricsFactory';

const delay = async (ms: number) => {
  return await new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const main = async () => {
  const headers = [new Header('lightstep-access-token', '')];
  const client = OpenTelemetryClient.connect({
    sillyOtlpHostname: 'ingest.lightstep.com',
    port: 443,
    metricDimensions: new Map(),
    resourceDimensions: new Map(),
    interceptors: [
      new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
    ],
  });

  const metrics = MetricsSetups.lightstepNativeOtlp({
    aggregationWidthMillis: 10 * 1000,
    lightstepAccessToken: '',
    logError(message: string, error: unknown): void {
      console.error(message, error);
    },
    onSendUnary(metrics: Metrics[]): void {
      console.log('sending unary', metrics);
    },
  });

  await delay(8000);
  await metrics.unaryMetricsFactory.record(
    'test',
    TimestampAt.Start,
    metrics => {
      metrics.measure('runs', 1);
    }
  );

  await delay(15000);
};

main().finally();
