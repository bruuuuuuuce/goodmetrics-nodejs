import {MetricsFactory, TotaltimeType} from './metricsFactory';
import {_Metrics, Dimension, Metrics} from './_Metrics';
import {
  OpenTelemetryClient,
  SecurityMode,
} from './downstream/openTelemetryClient';
import {MetricsSink} from './pipeline/metricsSink';
import {
  Header,
  HeaderInterceptorProvider,
} from './downstream/grpc/headerInterceptor';
import {SynchronizingBuffer} from './pipeline/synchronizingBuffer';
import {Batcher} from './pipeline/batcher';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as csp from 'js-csp';
import {AggregatedBatch, Aggregator} from './pipeline/aggregator';

export interface ConfiguredMetrics {
  unaryMetricsFactory: MetricsFactory;
  preaggregatedMetricsFactory: MetricsFactory;
}

interface LightstepNativeLambdaOtlpProps {
  lightstepAccessToken: string;
  prescientDimensions: Map<string, Dimension>;
  aggregationWidthMillis: number;
  lightstepUrl?: string;
  lightstepPort?: number;
  lightstepConnectionSecurityMode?: SecurityMode;
  timeoutSeconds?: number;
  logError: (message: string, error: unknown) => void;
  onSendUnary?: (metrics: Metrics[]) => void;
}

interface ConfigureBatchedUnaryLightstepSinkProps {
  batchSize: number;
  batchMaxAgeSeconds: number;
  client: OpenTelemetryClient;
  logError: (message: string, error: unknown) => void;
  onSendUnary?: (metrics: Metrics[]) => void;
}

interface ConfigureBatchedPreaggregatedLightstepSinkProps {
  aggregationWidthMillis?: number;
  batchSize: number;
  batchMaxAgeSeconds: number;
  client: OpenTelemetryClient;
  logError: (message: string, error: unknown) => void;
  onSendPreaggregated?: (aggregatedBatch: AggregatedBatch[]) => void;
}

interface PrivateOtelClientProps {
  lightstepToken: string;
  lightstepUrl: string;
  lightstepPort: number;
  metricDimensions: Map<string, Dimension>;
  resourceDimensions: Map<string, Dimension>;
}

interface LightstepNativeOtlpProps {
  lightstepAccessToken: string;
  aggregationWidthMillis: number;
  metricDimensions?: Map<string, Dimension>;
  resourceDimensions?: Map<string, Dimension>;
  logError: (message: string, error: unknown) => void;
  lightstepUrl?: string;
  lightstepPort?: number;
  lightstepConnectionSecurityMode?: SecurityMode;
  timeoutSeconds?: number;
  unaryBatchSizeMaxMetricsCount?: number;
  unaryBatchMaxAgeSeconds?: number;
  preaggregatedBatchMaxMetricsCount?: number;
  preaggregatedBatchMaxAgeSeconds?: number;
  onSendUnary?: (metrics: Metrics[]) => void;
  onSendPreaggregated?: (aggregatedBatch: AggregatedBatch[]) => void;
}

export class MetricsSetups {
  static lightstepNativeOtlp(
    props: LightstepNativeOtlpProps
  ): ConfiguredMetrics {
    const client = this.opentelemetryClient({
      metricDimensions: props.metricDimensions ?? new Map<string, Dimension>(),
      resourceDimensions:
        props.resourceDimensions ?? new Map<string, Dimension>(),
      lightstepToken: props.lightstepAccessToken,
      lightstepPort: props.lightstepPort ?? 443,
      lightstepUrl: props.lightstepUrl ?? 'ingest.lightstep.com',
    });

    const unarySink = this.configureBatchedUnaryLightstepSink({
      batchMaxAgeSeconds: props.unaryBatchMaxAgeSeconds ?? 10,
      batchSize: props.unaryBatchSizeMaxMetricsCount ?? 1000,
      client: client,
      logError: props.logError,
      onSendUnary: props.onSendUnary,
    });
    const preaggregatedSink = this.configureBatchedPreaggregatedLightstepSink({
      aggregationWidthMillis: props.aggregationWidthMillis,
      batchMaxAgeSeconds: props.preaggregatedBatchMaxAgeSeconds ?? 10,
      batchSize: props.preaggregatedBatchMaxMetricsCount ?? 1000,
      client: client,
      logError: props.logError,
      onSendPreaggregated: props.onSendPreaggregated,
    });

    const unaryMetricsFactory = new MetricsFactory({
      metricsSink: unarySink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });

    const preaggregatedMetricsFactory = new MetricsFactory({
      metricsSink: preaggregatedSink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });

    return {
      unaryMetricsFactory,
      preaggregatedMetricsFactory,
    };
  }
  static lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda(
    props: LightstepNativeLambdaOtlpProps
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
      close(): void {
        client.close();
      },
      emit(metrics: _Metrics): void {
        props?.onSendUnary && props.onSendUnary([metrics]);
        client
          .sendMetricsBatch([metrics])
          .catch(e =>
            props.logError('error while sending blocking metrics', e)
          );
      },
    };

    return new MetricsFactory({
      metricsSink: unarySink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });
  }

  private static configureBatchedUnaryLightstepSink(
    props: ConfigureBatchedUnaryLightstepSinkProps
  ): SynchronizingBuffer {
    const unarySink = new SynchronizingBuffer();
    const unaryBatcher = new Batcher({
      upstream: unarySink,
      batchSize: props.batchSize,
      batchAgeSeconds: props.batchMaxAgeSeconds,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    csp.go(async function* () {
      for await (const batch of unaryBatcher.consume()) {
        if (batch.length === 0) {
          console.log('batch array has no length, no metrics to send');
          yield;
          continue;
        }
        try {
          props.onSendUnary && props.onSendUnary(batch);
          await props.client.sendMetricsBatch(batch);
        } catch (e) {
          props.logError('failed to send unary batch', e);
        }
        yield;
      }
    });

    return unarySink;
  }

  private static configureBatchedPreaggregatedLightstepSink(
    props: ConfigureBatchedPreaggregatedLightstepSinkProps
  ): Aggregator {
    const sink = new Aggregator({
      aggregationWidthMillis: props.aggregationWidthMillis,
    });
    const aggregatedBatcher = new Batcher({
      upstream: sink,
      batchSize: props.batchSize,
      batchAgeSeconds: props.batchMaxAgeSeconds,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    csp.go(async function* () {
      for await (const batch of aggregatedBatcher.consume()) {
        if (batch.length === 0) {
          console.log('batch array has no length, no aggregated batch to send');
          yield;
          continue;
        }
        try {
          props.onSendPreaggregated && props.onSendPreaggregated(batch);
          await props.client.sendPreaggregatedBatch(batch);
        } catch (e) {
          props.logError('failed to send aggregated batch', e);
        }
        yield;
      }
    });

    return sink;
  }

  private static opentelemetryClient(
    props: PrivateOtelClientProps
  ): OpenTelemetryClient {
    const headers = [
      new Header('lightstep-access-token', props.lightstepToken),
    ];
    return OpenTelemetryClient.connect({
      sillyOtlpHostname: props.lightstepUrl ?? 'ingest.lightstep.com',
      port: props.lightstepPort ?? 443,
      metricDimensions: props.metricDimensions ?? new Map<string, Dimension>(),
      resourceDimensions:
        props.resourceDimensions ?? new Map<string, Dimension>(),
      interceptors: [
        new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
      ],
    });
  }
}
