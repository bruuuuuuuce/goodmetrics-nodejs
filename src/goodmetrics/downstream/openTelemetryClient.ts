import {Dimension, _Metrics} from '../_Metrics';
import {
  otlp_common,
  otlp_metrics,
  otlp_metric_service,
  otlp_resource,
} from 'otlp-generated';
import ResourceMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ResourceMetrics;
import MetricsServiceClient = otlp_metric_service.opentelemetry.proto.collector.metrics.v1.MetricsServiceClient;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;
import Resource = otlp_resource.opentelemetry.proto.resource.v1.Resource;
import ExportMetricsServiceRequest = otlp_metric_service.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;
import {AggregatedBatch} from '../pipeline/aggregator';
import ScopeMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ScopeMetrics;
import {library} from '../data/otlp/library';
import {ChannelCredentials, Interceptor} from '@grpc/grpc-js';

export enum SecurityMode {
  Plaintext = 'plaintext',
  Tls = 'tls',
}

interface OpenTelemetryClientProps {
  address: string;
  channelCredentials: ChannelCredentials;
  resourceDimensions: Map<string, Dimension>;
  metricDimensions: Map<string, Dimension>;
  timeoutMillis: number;
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
  interceptors: Interceptor[];
}

interface ConnectProps {
  sillyOtlpHostname?: string;
  port?: number;
  resourceDimensions: Map<string, Dimension>;
  metricDimensions: Map<string, Dimension>;
  securityMode?: SecurityMode;
  timeoutMillis?: number;
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
  interceptors: Interceptor[];
}

function asOtlpDimensions(map: Map<string, Dimension>): KeyValue[] {
  const keyValues: KeyValue[] = [];
  map.forEach((dimension, _key) => {
    const kv = dimension.asOtlpKeyValue();
    keyValues.push(kv);
  });

  return keyValues;
}

export class OpenTelemetryClient {
  private readonly client: MetricsServiceClient;
  private readonly interceptors: Interceptor[];
  private readonly resourceDimensions: Resource;
  private readonly metricDimensions: Resource;
  private readonly logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
  constructor(props: OpenTelemetryClientProps) {
    this.client = new MetricsServiceClient(
      props.address,
      props.channelCredentials
    );
    this.resourceDimensions = new Resource({
      attributes: asOtlpDimensions(props.resourceDimensions),
    });
    this.metricDimensions = new Resource({
      attributes: asOtlpDimensions(props.metricDimensions),
    });
    this.logRawPayload = props.logRawPayload;
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
    const resourceMetrics = this.asResourceMetrics(batch);
    this.logRawPayload && this.logRawPayload(resourceMetrics);

    return new Promise((resolve, reject) => {
      this.client.Export(
        new ExportMetricsServiceRequest({
          resource_metrics: [resourceMetrics],
        }),
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

  close() {
    this.client.close();
  }

  sendPreaggregatedBatch(batch: AggregatedBatch[]): Promise<void> {
    const resourceMetricsBatch = this.asResourceMetricsFromBatch(batch);
    this.logRawPayload && this.logRawPayload(resourceMetricsBatch);

    return new Promise((resolve, reject) => {
      this.client.Export(
        new ExportMetricsServiceRequest({
          resource_metrics: [resourceMetricsBatch],
        }),
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

  private asScopeMetrics(batch: _Metrics[]): ScopeMetrics {
    return new ScopeMetrics({
      scope: library,
      metrics: batch.flatMap(b => b.asGoofyOtlpMetricSequence()),
    });
  }

  private asResourceMetrics(batch: _Metrics[]): ResourceMetrics {
    return new ResourceMetrics({
      scope_metrics: [this.asScopeMetrics(batch)],
      resource: this.resourceDimensions,
    });
  }

  private asResourceMetricsFromBatch(
    batch: AggregatedBatch[]
  ): ResourceMetrics {
    return new ResourceMetrics({
      resource: this.resourceDimensions,
      scope_metrics: batch.map(b => b.asOtlpScopeMetrics()),
    });
  }
}
