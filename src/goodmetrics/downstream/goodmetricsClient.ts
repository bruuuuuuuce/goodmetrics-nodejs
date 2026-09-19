import {_Metrics, Dimension} from '../_Metrics';
import {goodmetrics} from 'goodmetrics-generated';
import MetricsClient = goodmetrics.MetricsClient;
import {ChannelCredentials, Interceptor} from '@grpc/grpc-js';
import MetricsRequest = goodmetrics.MetricsRequest;
import {AggregatedBatch} from '../pipeline/aggregator';
import {SecurityMode} from './openTelemetryClient';

interface GoodmetricsClientProps {
  address: string;
  channelCredentials: ChannelCredentials;
  sharedDimensions: Map<string, Dimension>;
}
interface GoodmetricsConnectProps {
  hostname: string;
  port: number;
  /**
   * defaults to `SecurityMode.Tls`. Use `SecurityMode.Plaintext` to connect to a local/dev
   * goodmetrics server that doesn't terminate TLS (e.g. the `localhost:9573` default used by
   * `MetricsSetups.goodMetrics()`).
   */
  securityMode?: SecurityMode;
  /**
   * Dimensions to attach to every batch this client sends, via `MetricsRequest.shared_dimensions`.
   * Defaults to no shared dimensions.
   */
  sharedDimensions?: Map<string, Dimension>;
}

export class GoodmetricsClient {
  private readonly sharedDimensions: Map<string, Dimension>;
  private readonly client: MetricsClient;
  private readonly interceptors: Interceptor[];
  private constructor(props: GoodmetricsClientProps) {
    this.client = new MetricsClient(props.address, props.channelCredentials);
    this.sharedDimensions = props.sharedDimensions;
    this.interceptors = [];
  }

  static connect(props: GoodmetricsConnectProps): GoodmetricsClient {
    let channelCredentials: ChannelCredentials;
    switch (props.securityMode) {
      case SecurityMode.Plaintext:
        channelCredentials = ChannelCredentials.createInsecure();
        break;
      case SecurityMode.Tls:
      default:
        channelCredentials = ChannelCredentials.createSsl();
        break;
    }
    return new GoodmetricsClient({
      address: `${props.hostname}:${props.port}`,
      channelCredentials,
      sharedDimensions: props.sharedDimensions ?? new Map<string, Dimension>(),
    });
  }

  async sendMetricsBatch(metrics: _Metrics[]): Promise<void> {
    const request = new MetricsRequest({
      shared_dimensions: this.sharedDimensionsToProto(),
      metrics: this.metricsToGoodmetrics(metrics),
    });

    return await new Promise((resolve, reject) => {
      this.client.SendMetrics(request, {interceptors: this.interceptors}, e => {
        if (!e) {
          resolve();
        } else {
          reject(e);
        }
      });
    });
  }

  async sendPreaggregatedMetrics(
    aggregatedBatch: AggregatedBatch[]
  ): Promise<void> {
    const datums: goodmetrics.Datum[] = [];
    for (const batch of aggregatedBatch) {
      datums.push(...batch.asGoodmetrics());
    }
    const request = new MetricsRequest({
      shared_dimensions: this.sharedDimensionsToProto(),
      metrics: datums,
    });

    return await new Promise((resolve, reject) => {
      this.client.SendMetrics(request, {interceptors: this.interceptors}, e => {
        if (!e) {
          resolve();
        } else {
          reject(e);
        }
      });
    });
  }

  private sharedDimensionsToProto(): Map<string, goodmetrics.Dimension> {
    const dimensionsMap = new Map<string, goodmetrics.Dimension>();
    for (const [key, dimen] of this.sharedDimensions) {
      dimensionsMap.set(key, dimen.asGoodmetricsDimension());
    }
    return dimensionsMap;
  }

  private metricsToGoodmetrics(metrics: _Metrics[]): goodmetrics.Datum[] {
    return metrics.map(metric => {
      const dimensionsMap = new Map<string, goodmetrics.Dimension>();
      const measurementsMap = new Map<string, goodmetrics.Measurement>();
      for (const [key, dimen] of metric.metricDimensions) {
        dimensionsMap.set(key, dimen.asGoodmetricsDimension());
      }
      for (const [key, value] of metric.metricMeasurements) {
        const _int = Number.isInteger(value) ? value : undefined;
        if (_int) {
          measurementsMap.set(key, new goodmetrics.Measurement({i64: _int}));
        } else {
          measurementsMap.set(key, new goodmetrics.Measurement({f64: value}));
        }
      }
      for (const [key, value] of metric.metricDistributions) {
        measurementsMap.set(
          key,
          new goodmetrics.Measurement({i64: Math.floor(value)})
        );
      }
      return new goodmetrics.Datum({
        metric: metric.name,
        dimensions: dimensionsMap,
        measurements: measurementsMap,
      });
    });
  }
}
