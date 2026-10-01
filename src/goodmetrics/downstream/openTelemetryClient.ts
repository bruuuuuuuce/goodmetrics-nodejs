import {MetricDimension, ResourceDimensions, _Metrics} from '../_Metrics';
import {otlp_metric_service, otlp_metrics} from 'otlp-generated';
import ResourceMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ResourceMetrics;
import MetricsServiceClient = otlp_metric_service.opentelemetry.proto.collector.metrics.v1.MetricsServiceClient;
import {AggregatedBatch} from '../pipeline/aggregator';
import {ChannelCredentials, Interceptor} from '@grpc/grpc-js';
import {OtlpRequestEncoder} from './otlpRequestEncoder';
import {OtlpMetricsExporter} from './otlpMetricsExporter';

export enum SecurityMode {
  Plaintext = 'plaintext',
  Tls = 'tls',
}

interface OpenTelemetryClientProps {
  address: string;
  channelCredentials: ChannelCredentials;
  resourceDimensions: ResourceDimensions;
  metricDimensions: MetricDimension;
  timeoutMillis: number;
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
  interceptors: Interceptor[];
}

interface ConnectProps {
  sillyOtlpHostname?: string;
  port?: number;
  resourceDimensions: ResourceDimensions;
  metricDimensions: MetricDimension;
  securityMode?: SecurityMode;
  timeoutMillis?: number;
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
  interceptors: Interceptor[];
}

export class OpenTelemetryClient implements OtlpMetricsExporter {
  private readonly client: MetricsServiceClient;
  private readonly interceptors: Interceptor[];
  private readonly encoder: OtlpRequestEncoder;
  constructor(props: OpenTelemetryClientProps) {
    this.client = new MetricsServiceClient(
      props.address,
      props.channelCredentials
    );
    this.encoder = new OtlpRequestEncoder({
      resourceDimensions: props.resourceDimensions,
      metricDimensions: props.metricDimensions,
      logRawPayload: props.logRawPayload,
    });
    this.interceptors = props.interceptors;
  }

  static connect(props: ConnectProps): OpenTelemetryClient {
    let channelCreds: ChannelCredentials;
    switch (props.securityMode) {
      case SecurityMode.Plaintext:
        channelCreds = ChannelCredentials.createInsecure();
        break;
      case SecurityMode.Tls:
      default:
        channelCreds = ChannelCredentials.createSsl();
        break;
    }
    const port = props.port ?? 5001;
    const hostname = props.sillyOtlpHostname ?? 'localhost';
    return new OpenTelemetryClient({
      address: `${hostname}:${port}`,
      channelCredentials: channelCreds,
      resourceDimensions: props.resourceDimensions,
      metricDimensions: props.metricDimensions,
      timeoutMillis: props.timeoutMillis ?? 5 * 1000,
      logRawPayload: props.logRawPayload,
      interceptors: props.interceptors,
    });
  }

  sendMetricsBatch(batch: _Metrics[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.Export(
        this.encoder.unary(batch),
        {interceptors: this.interceptors},
        e => {
          if (!e) {
            resolve();
          } else {
            reject(e);
          }
        }
      );
    });
  }

  close(): void {
    this.client.close();
  }

  sendPreaggregatedBatch(batch: AggregatedBatch[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.Export(
        this.encoder.preaggregated(batch),
        {interceptors: this.interceptors},
        e => {
          if (!e) {
            resolve();
          } else {
            reject(e);
          }
        }
      );
    });
  }
}
