# Goodmetrics Nodejs

Nodejs metrics client to be used with either the goodmetrics protocol, or any open telemetry compliant protocol.
Currently has a built in lightstep open telemetry client.

This library is based off of the opensource [kotlin goodmetrics library](https://github.com/kvc0/goodmetrics_kotlin)

## Installing
```bash
npm i goodmetrics-nodejs
```

example usages 
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

  // using goodmetrics
  const goodmetrics = MetricsSetups.goodMetrics();
  await goodmetrics.unaryMetricsFactory.record({name: 'unary'}, metrics => {
    metrics.dimension('is_local', true);
    metrics.measure('runs', 1);
  });
  await goodmetrics.preaggregatedMetricsFactory.record(
    {name: 'preaggregated'},
    metrics => {
        metrics.measure('w00t', 1);
    }
  );
};

main().finally();
```

## Protos
- [open telemetry client protos](https://github.com/bruuuuuuuce/otlp-generated)
- [goodmetrics client protos](https://github.com/bruuuuuuuce/goodmetrics-generated)

## Goodmetrics
More information about the goodmetrics protocol can be found [here](https://github.com/kvc0/goodmetrics)
