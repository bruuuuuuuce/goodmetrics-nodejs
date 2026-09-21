import {Batcher} from '../../src/goodmetrics/pipeline/batcher';
import {MetricsPipeline} from '../../src/goodmetrics/pipeline/metricsPipeline';

function upstreamOf(items: string[]): MetricsPipeline<string> {
  return {
    async *consume(): AsyncGenerator<string, void, void> {
      for (const item of items) {
        yield item;
      }
      // then hang forever, like a real upstream that hasn't produced more yet
      await new Promise<void>(() => {});
    },
  };
}

describe('Batcher', () => {
  it('yields a batch as soon as batchSize items are available', async () => {
    const upstream = upstreamOf(['a', 'b', 'c', 'd']);
    const batcher = new Batcher({
      upstream,
      batchSize: 2,
      batchAgeSeconds: 10,
    });

    const {value} = await batcher.consume().next();
    expect(value).toEqual(['a', 'b']);
  });

  it('flushes a partial batch once batchAgeSeconds elapses', async () => {
    const upstream = upstreamOf(['only']);
    const batcher = new Batcher({
      upstream,
      batchSize: 1000,
      batchAgeSeconds: 0.02,
    });

    const {value} = await batcher.consume().next();
    expect(value).toEqual(['only']);
  });

  it('flushes an empty batch on age timeout when upstream produced nothing', async () => {
    const upstream = upstreamOf([]);
    const batcher = new Batcher({
      upstream,
      batchSize: 1000,
      batchAgeSeconds: 0.02,
    });

    const {value} = await batcher.consume().next();
    expect(value).toEqual([]);
  });

  it('stops consume() once closed', async () => {
    const upstream = upstreamOf([]);
    const batcher = new Batcher({
      upstream,
      batchSize: 1000,
      batchAgeSeconds: 10,
    });

    const gen = batcher.consume();
    const pending = gen.next();
    batcher.close();

    const result = await pending;
    expect(result.done).toBe(true);
  });
});
