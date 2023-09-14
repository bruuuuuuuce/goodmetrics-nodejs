import {MetricsFactory, TotaltimeType} from './metricsFactory';
import {Dimension, _Metrics} from './_Metrics';
import {
  OpenTelemetryClient,
  SecurityMode,
} from './downstream/openTelemetryClient';
import {MetricsSink} from './pipeline/metricsSink';
import {
  Header,
  HeaderInterceptorProvider,
} from './downstream/grpc/headerInterceptor';

export interface ConfiguredMetrics {
  unaryMetricsFactory: MetricsFactory;
  preaggregatedMetricsFactory: MetricsFactory;
}

interface LightstepNativeOtlpProps {
  lightstepAccessToken: string;
  prescientDimensions: Map<string, Dimension>;
  aggregationWidthMillis: number;
  lightstepUrl?: string;
  lightstepPort?: number;
  lightstepConnectionSecurityMode?: SecurityMode;
  timeoutSeconds?: number;
}

export class MetricsSetups {
  static lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda(
    props: LightstepNativeOtlpProps
  ): MetricsFactory {
    const headers = [
      new Header('lightstep-access-token', props.lightstepAccessToken),
    ];
    const client = OpenTelemetryClient.connect({
      sillyOtlpHostname: props.lightstepUrl ?? 'ingest.lightstep.com',
      port: props.lightstepPort ?? 443,
      metricDimensions: new Map(),
      resourceDimensions: new Map(),
      interceptors: [
        new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
      ],
    });
    const unarySink: MetricsSink = {
      async emit(metrics: _Metrics): Promise<void> {
        await client.sendMetricsBatch([metrics]);
        return Promise.resolve(undefined);
      },
    };

    return new MetricsFactory({
      metricsSink: unarySink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });
  }
}
