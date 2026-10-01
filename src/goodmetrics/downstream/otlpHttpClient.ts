import * as http from 'http';
import * as https from 'https';
import {Dimension, _Metrics} from '../_Metrics';
import {AggregatedBatch} from '../pipeline/aggregator';
import {OtlpMetricsExporter} from './otlpMetricsExporter';
import {OtlpRequestEncoder} from './otlpRequestEncoder';
import {decodeMetricsPartialSuccess} from './otlpMetricsResponse';

interface ConnectProps {
  endpointUrl: string;
  headers?: Record<string, string>;
  resourceDimensions: Map<string, Dimension>;
  metricDimensions: Map<string, Dimension>;
  timeoutMillis?: number;
}

const MAX_ERROR_BYTES = 1024;
const MAX_SUCCESS_BYTES = 4 * 1024 * 1024;

class LocalTransportError extends Error {}

export class OtlpHttpClient implements OtlpMetricsExporter {
  private readonly endpoint: URL;
  private readonly headers: Record<string, string>;
  private readonly timeoutMillis: number;
  private readonly encoder: OtlpRequestEncoder;
  private readonly activeRequests = new Set<http.ClientRequest>();
  private closed = false;

  private constructor(props: ConnectProps) {
    const endpoint = new URL(props.endpointUrl);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      !endpoint.pathname.endsWith('/v1/metrics') ||
      endpoint.search !== '' ||
      endpoint.hash !== '' ||
      endpoint.username !== '' ||
      endpoint.password !== ''
    ) {
      throw new Error(
        'OTLP HTTP endpoint must be an http(s) /v1/metrics URL without credentials, query, or fragment'
      );
    }
    if (
      props.timeoutMillis !== undefined &&
      (!Number.isFinite(props.timeoutMillis) || props.timeoutMillis <= 0)
    ) {
      throw new Error('OTLP HTTP timeoutMillis must be positive');
    }
    this.endpoint = endpoint;
    this.headers = {...props.headers};
    this.timeoutMillis = props.timeoutMillis ?? 5000;
    this.encoder = new OtlpRequestEncoder({
      resourceDimensions: props.resourceDimensions,
      metricDimensions: props.metricDimensions,
    });
  }

  static connect(props: ConnectProps): OtlpHttpClient {
    return new OtlpHttpClient(props);
  }

  sendMetricsBatch(batch: _Metrics[]): Promise<void> {
    return this.send(this.encoder.unary(batch).serializeBinary());
  }

  sendPreaggregatedBatch(batch: AggregatedBatch[]): Promise<void> {
    return this.send(this.encoder.preaggregated(batch).serializeBinary());
  }

  close(): void {
    this.closed = true;
    for (const request of this.activeRequests) {
      request.destroy(new LocalTransportError('OTLP HTTP exporter closed'));
    }
    this.activeRequests.clear();
  }

  private safeTransportError(error: Error): Error {
    if (
      error instanceof LocalTransportError ||
      Object.keys(this.headers).length === 0
    ) {
      return error;
    }
    // Node parser errors can carry raw response bytes, including echoed secrets.
    return new Error('OTLP HTTP transport failed');
  }

  private send(bytes: Uint8Array): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('OTLP HTTP exporter closed'));
    }
    const body = Buffer.from(bytes);
    const transport = this.endpoint.protocol === 'https:' ? https : http;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(deadline);
        this.activeRequests.delete(request);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const request = transport.request(
        this.endpoint,
        {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-protobuf',
            'Content-Length': body.length,
          },
        },
        response => {
          const status = response.statusCode ?? 0;
          let errorBody = Buffer.alloc(0);
          const successBody: Buffer[] = [];
          let successBodyBytes = 0;
          response.on('data', (chunk: Buffer) => {
            if (status < 200 || status >= 300) {
              errorBody = Buffer.concat([errorBody, chunk]).subarray(
                0,
                MAX_ERROR_BYTES
              );
            } else {
              successBodyBytes += chunk.length;
              if (successBodyBytes > MAX_SUCCESS_BYTES) {
                response.destroy(new Error('OTLP HTTP response is too large'));
                return;
              }
              successBody.push(chunk);
            }
          });
          response.on('error', error => {
            complete(this.safeTransportError(error));
          });
          response.on('end', () => {
            if (status >= 200 && status < 300) {
              try {
                const partial = decodeMetricsPartialSuccess(
                  Buffer.concat(successBody)
                );
                if (
                  partial &&
                  (partial.rejectedDataPoints !== 0n || partial.message !== '')
                ) {
                  const detail =
                    Object.keys(this.headers).length === 0
                      ? partial.message.slice(0, MAX_ERROR_BYTES)
                      : '[response detail omitted]';
                  complete(
                    new Error(
                      `OTLP HTTP partial success: ${partial.rejectedDataPoints} rejected data points; ${detail}`
                    )
                  );
                } else {
                  complete();
                }
              } catch {
                complete(new Error('Invalid OTLP HTTP metrics response'));
              }
              return;
            }
            const excerpt =
              Object.keys(this.headers).length === 0
                ? errorBody.toString('utf8').slice(0, MAX_ERROR_BYTES)
                : '[response body omitted]';
            complete(
              new Error(
                `OTLP HTTP export failed with status ${status}: ${excerpt}`
              )
            );
          });
        }
      );
      this.activeRequests.add(request);
      const deadline = setTimeout(() => {
        request.destroy(
          new LocalTransportError(
            `OTLP HTTP request timed out after ${this.timeoutMillis} ms`
          )
        );
      }, this.timeoutMillis);
      request.on('error', error => {
        complete(this.safeTransportError(error));
      });
      request.end(body);
    });
  }
}
