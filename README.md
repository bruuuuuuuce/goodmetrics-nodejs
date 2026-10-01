# Goodmetrics Nodejs

Nodejs metrics client to be used with either the goodmetrics protocol, or any open telemetry compliant protocol.
Includes OpenTelemetry clients for Lightstep, direct Datadog and Grafana Cloud intake, and other OTLP backends.

This library is based off of the opensource [kotlin goodmetrics library](https://github.com/kvc0/goodmetrics_kotlin)

## Installing

Requires Node.js 22 or newer.

```bash
npm i goodmetrics-nodejs
```

## Example usage
```javascript
import {Dimension, MetricsSetups} from 'goodmetrics-nodejs';

const main = async () => {
  // metrics setup for recording metrics inside of a lambda
  const lambdaMetrics =
    MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda({
      lightstepAccessToken: '<your lightstep api key>',
      resourceDimensions: new Map<string, Dimension>(),
    });

  await lambdaMetrics.record(
    {name: 'test'},
    async metrics => {
      console.info('inside metrics block');
      metrics.measure('runs', 1);
      // await some async task
      metrics.dimension('result', 'success');
    }
  );
};

main().finally();
```

See [`examples/`](./examples) for direct [Datadog](./examples/datadog-cloud.ts) and
[Grafana Cloud](./examples/grafana-cloud.ts) intake, long-running processes with batching,
generic OTLP/gRPC receivers, and the bespoke `goodmetrics` protocol. Direct cloud intake uses
OTLP/HTTP Protobuf at a complete `/v1/metrics` URL; the existing gRPC examples point to an
Agent, Alloy, or collector.

## Protos
- [open telemetry client protos](https://github.com/bruuuuuuuce/otlp-generated)
- [goodmetrics client protos](https://github.com/bruuuuuuuce/goodmetrics-generated)

## Goodmetrics
More information about the goodmetrics protocol can be found [here](https://github.com/kvc0/goodmetrics)
