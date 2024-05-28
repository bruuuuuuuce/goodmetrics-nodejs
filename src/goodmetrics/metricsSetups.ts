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
import {GoodmetricsClient} from './downstream/goodmetricsClient';

export interface ConfiguredMetrics {
  unaryMetricsFactory: MetricsFactory;
  preaggregatedMetricsFactory: MetricsFactory;
}

interface LightstepNativeLambdaOtlpProps {
  /**
   * programmatic access token for the lightstep backend
   * https://docs.lightstep.com/docs/create-and-manage-api-keys
   */
  lightstepAccessToken: string;
  /**
   * Included resource dimensions on the OTLP resource. Ex. AWS_REGION, ACCOUNT_ID etc...
   */
  resourceDimensions: Map<string, Dimension>;
  /**
   * defaults to `ingest.lightstep.com`, the default lightstep ingest url
   */
  lightstepUrl?: string;
  /**
   * defaults to 443, the default lightstep port
   */
  lightstepPort?: number;
  logError: (message: string, error: unknown) => void;
  /**
   * Mostly for debugging purposes, logs after successfully sending metrics to the backend.
   * Used to tell if the promise fully resolved
   */
  doLogSuccess?: boolean;
  onSendUnary?: (metrics: Metrics[]) => void;
}

interface RawNativeLambdaOtlpForLambdaProps {
  /**
   * programmatic access token for the otlp metric backend
   */
  accessToken: string;
  /**
   * Name of the header to use for authentication. Ex. `api-token`
   */
  authHeaderName: string;
  /**
   * Included resource dimensions on the OTLP resource. Ex. AWS_REGION, ACCOUNT_ID etc...
   */
  resourceDimensions: Map<string, Dimension>;
  /**
   * Include resource dimensions on each metric instead of on the Resource. You'd use this for
   * downstreams that either do not support or do something undesirable with Resource dimensions.
   */
  sharedDimensions: Map<string, Dimension>;
  /**
   * example `ingest.lightstep.com`
   */
  ingestUrl: string;
  /**
   * defaults to 443
   */
  ingestPort?: number;
  logError: (message: string, error: unknown) => void;
  /**
   * Mostly for debugging purposes, logs after successfully sending metrics to the backend.
   * Used to tell if the promise fully resolved
   */
  doLogSuccess?: boolean;
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
  headers: Header[];
  ingestUrl: string;
  ingestPort: number;
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

interface GoodmetricsSetupProps {
  host?: string;
  port?: number;
  aggregationWidthMillis?: number;
}

export class MetricsSetups {
  static goodMetrics(props?: GoodmetricsSetupProps): ConfiguredMetrics {
    const host = props?.host ?? 'localhost';
    const port = props?.port ?? 9573;
    const aggregationWidthMillis = props?.aggregationWidthMillis ?? 10 * 1000;
    const unaryFactory = this.configureGoodmetricsUnaryFactory({
      host: host,
      port: port,
    });
    const preaggregatedFactory = this.configureGoodmetricsPreaggregatedFactory({
      host,
      port,
      aggregationWidthMillis,
    });

    return {
      unaryMetricsFactory: unaryFactory,
      preaggregatedMetricsFactory: preaggregatedFactory,
    };
  }
  static lightstepNativeOtlp(
    props: LightstepNativeOtlpProps
  ): ConfiguredMetrics {
    const client = this.opentelemetryClient({
      metricDimensions: props.metricDimensions ?? new Map<string, Dimension>(),
      resourceDimensions:
        props.resourceDimensions ?? new Map<string, Dimension>(),
      ingestPort: props.lightstepPort ?? 443,
      ingestUrl: props.lightstepUrl ?? 'ingest.lightstep.com',
      headers: [
        new Header('lightstep-access-token', props.lightstepAccessToken),
      ],
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

  /**
   * Configures a unary metric factory pointing to lightstep downstream, which will send and record metrics upon lambda
   * completion
   * @param props
   */
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
      resourceDimensions: props.resourceDimensions,
      interceptors: [
        new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
      ],
    });
    const unarySink: MetricsSink = {
      close(): void {
        client.close();
      },
      async emit(metrics: _Metrics): Promise<void> {
        props?.onSendUnary && props.onSendUnary([metrics]);
        try {
          await client.sendMetricsBatch([metrics]);
          props.doLogSuccess && console.log('metrics sent to backend');
        } catch (e) {
          props.logError('error while sending blocking metrics', e);
        }
      },
    };

    return new MetricsFactory({
      metricsSink: unarySink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });
  }

  /**
   * Configures a unary metric factory pointing to any arbitrary oltp metrics backend, which will send and record metrics upon lambda
   * completion
   * @param props
   */
  static rawNativeOtlpButItSendsMetricsUponRecordingForLambda(
    props: RawNativeLambdaOtlpForLambdaProps
  ): MetricsFactory {
    const headers = [
      new Header(props.authHeaderName, props.accessToken),
    ];
    const client = OpenTelemetryClient.connect({
      sillyOtlpHostname: props.ingestUrl,
      port: props.ingestPort ?? 443,
      metricDimensions: props.sharedDimensions,
      resourceDimensions: props.resourceDimensions,
      interceptors: [
        new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
      ],
    });
    const unarySink: MetricsSink = {
      close(): void {
        client.close();
      },
      async emit(metrics: _Metrics): Promise<void> {
        props?.onSendUnary && props.onSendUnary([metrics]);
        try {
          await client.sendMetricsBatch([metrics]);
          props.doLogSuccess && console.log('metrics sent to backend');
        } catch (e) {
          props.logError('error while sending blocking metrics', e);
        }
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

  static opentelemetryClient(
    props: PrivateOtelClientProps
  ): OpenTelemetryClient {
    const headers = props.headers;
    return OpenTelemetryClient.connect({
      sillyOtlpHostname: props.ingestUrl,
      port: props.ingestPort,
      metricDimensions: props.metricDimensions ?? new Map<string, Dimension>(),
      resourceDimensions:
        props.resourceDimensions ?? new Map<string, Dimension>(),
      interceptors: [
        new HeaderInterceptorProvider(headers).createHeadersInterceptor(),
      ],
    });
  }

  private static configureGoodmetricsUnaryFactory(props: {
    host: string;
    port: number;
  }): MetricsFactory {
    const unaryClient = GoodmetricsClient.connect({
      hostname: props.host,
      port: props.port,
    });
    const unarySink = new SynchronizingBuffer();
    const unaryFactory = new MetricsFactory({
      metricsSink: unarySink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });
    const unaryBatcher = new Batcher({upstream: unarySink});

    // launching coroutine to process unary metric batches
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    csp.go(async function* () {
      for await (const batch of unaryBatcher.consume()) {
        if (batch.length === 0) {
          console.log('batch array has no length, no metrics to send');
          yield;
          continue;
        }
        try {
          await unaryClient.sendMetricsBatch(batch);
        } catch (e) {
          console.error('failed to send unary batch', e);
        }
        yield;
      }
    });

    return unaryFactory;
  }

  private static configureGoodmetricsPreaggregatedFactory(props: {
    host: string;
    port: number;
    aggregationWidthMillis: number;
  }): MetricsFactory {
    const preaggregatedClient = GoodmetricsClient.connect({
      hostname: props.host ?? 'localhost',
      port: props.port ?? 9573,
    });
    const preaggregatedSink = new Aggregator({
      aggregationWidthMillis: props.aggregationWidthMillis,
    });
    const preaggregatedFactory = new MetricsFactory({
      metricsSink: preaggregatedSink,
      totalTimeType: TotaltimeType.DistributionMilliseconds,
    });
    const preaggregatedBatcher = new Batcher({upstream: preaggregatedSink});

    // launching coroutine to process unary metric batches
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    csp.go(async function* () {
      for await (const batch of preaggregatedBatcher.consume()) {
        if (batch.length === 0) {
          console.log('batch array has no length, no metrics to send');
          yield;
          continue;
        }
        try {
          await preaggregatedClient.sendPreaggregatedMetrics(batch);
        } catch (e) {
          console.error('failed to send preaggregated batch', e);
        }
        yield;
      }
    });

    return preaggregatedFactory;
  }
}
