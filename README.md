# Goodmetrics Nodejs

example usage
```javascript
import {Dimension, MetricsSetups} from 'goodmetrics-nodejs';

const delay = async (ms: number): Promise<void> => {
  return await new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const main = async () => {
  const metrics =
    MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda({
      aggregationWidthMillis: 10 * 1000 * 1000,
      lightstepAccessToken: '<your lightstep api key>',
      prescientDimensions: new Map<string, Dimension>(),
    });

  await metrics.unaryMetricsFactory.record(
    {name: 'test'},
    async metrics => {
      console.info('inside metrics block');
      metrics.measure('runs', 1);
      await delay(100);
      metrics.dimension('result', 'success');
    }
  );
};

main().finally();
```
