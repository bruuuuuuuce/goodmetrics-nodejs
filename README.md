# Goodmetrics Nodejs

example usage
```javascript
import {MetricsSetups} from './goodmetrics/metricsSetups';
import {Dimension} from './goodmetrics/_Metrics';
import {TimestampAt} from './goodmetrics/metricsFactory';

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

  await metrics.record('my_metric', TimestampAt.Start, async metrics => {
    console.info('inside metrics block');
    metrics.measure('runs', 1);
    await delay(100);
    metrics.dimension('result', 'success');
  });
};

main().finally();
```