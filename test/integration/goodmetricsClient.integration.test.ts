import * as grpc from '@grpc/grpc-js';
import {goodmetrics} from 'goodmetrics-generated';
import {GoodmetricsClient} from '../../src/goodmetrics/downstream/goodmetricsClient';
import {SecurityMode} from '../../src/goodmetrics/downstream/openTelemetryClient';
import {_Metrics} from '../../src/goodmetrics/_Metrics';

/**
 * Exercises the real serialize -> gRPC wire -> deserialize path through the
 * goodmetrics-generated/@grpc/grpc-js/google-protobuf stack, using a real (in-process, plaintext)
 * gRPC server implementing the same `Metrics` service definition that GoodmetricsClient targets.
 * This is meant to catch behavior changes across bumps of those dependencies, not just type
 * checking.
 */
describe('GoodmetricsClient e2e', () => {
  let server: grpc.Server;
  let port: number;
  let receivedRequests: goodmetrics.MetricsRequest[];

  beforeAll(async () => {
    server = new grpc.Server();
    server.addService(goodmetrics.UnimplementedMetricsService.definition, {
      SendMetrics: (
        call: grpc.ServerUnaryCall<
          goodmetrics.MetricsRequest,
          goodmetrics.MetricsReply
        >,
        callback: grpc.sendUnaryData<goodmetrics.MetricsReply>
      ) => {
        receivedRequests.push(call.request);
        callback(null, new goodmetrics.MetricsReply({}));
      },
    });

    port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, boundPort) => {
          if (err) {
            reject(err);
          } else {
            resolve(boundPort);
          }
        }
      );
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.tryShutdown(() => resolve()));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  it('round-trips dimensions and measurements through a real gRPC call', async () => {
    const client = GoodmetricsClient.connect({
      hostname: '127.0.0.1',
      port,
      securityMode: SecurityMode.Plaintext,
    });

    const metrics = new _Metrics({
      name: 'e2e_test_metric',
      timestampMillis: Date.now(),
    });
    metrics.dimension('stringDim', 'hello');
    metrics.dimension('numberDim', 42);
    metrics.dimension('boolDim', true);
    metrics.measure('intMeasurement', 7);
    metrics.measure('floatMeasurement', 3.14);

    await client.sendMetricsBatch([metrics]);

    expect(receivedRequests).toHaveLength(1);
    const [datum] = receivedRequests[0].metrics;
    expect(datum.metric).toBe('e2e_test_metric');

    expect(datum.dimensions.get('stringDim')?.string).toBe('hello');
    expect(datum.dimensions.get('numberDim')?.number).toBe(42);
    expect(datum.dimensions.get('boolDim')?.boolean).toBe(true);

    expect(datum.measurements.get('intMeasurement')?.i64).toBe(7);
    expect(datum.measurements.get('floatMeasurement')?.f64).toBeCloseTo(3.14);
  });
});
