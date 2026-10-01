import {Batcher} from '@src/goodmetrics/pipeline/batcher';
import {MetricsPipeline} from '@src/goodmetrics/pipeline/metricsPipeline';
import {SynchronizingBuffer} from '@src/goodmetrics/pipeline/synchronizingBuffer';
import {_Metrics} from '@src/goodmetrics/_Metrics';
import {CancellationToken} from '@src/goodmetrics/pipeline/cancellationToken';

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
  it.each([0, -1, NaN, Infinity, 0.5])(
    'rejects invalid batch size %s before starting consumption',
    batchSize => {
      expect(() => new Batcher({upstream: upstreamOf([]), batchSize})).toThrow(
        /batchSize/
      );
    }
  );

  it.each([-1, NaN, Infinity, -Infinity])(
    'rejects invalid batch age %s',
    batchAgeSeconds => {
      expect(
        () => new Batcher({upstream: upstreamOf([]), batchAgeSeconds})
      ).toThrow(/batchAgeSeconds/);
    }
  );

  it('accepts zero batch age as the default', () => {
    expect(
      () => new Batcher({upstream: upstreamOf([]), batchAgeSeconds: 0})
    ).not.toThrow();
  });

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

  it('defaults batchSize and batchAgeSeconds when omitted', () => {
    const upstream = upstreamOf([]);
    const batcher = new Batcher({upstream});

    expect(batcher).toBeInstanceOf(Batcher);
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

  it('retains metrics arriving while the consumer holds the previous batch', async () => {
    const upstream = new SynchronizingBuffer();
    const batcher = new Batcher({
      upstream,
      batchSize: 1000,
      batchAgeSeconds: 0.02,
    });
    const batches = batcher.consume();

    try {
      upstream.emit(new _Metrics({name: 'first', timestampMillis: 1}));
      const first = await batches.next();
      expect(first.value?.map(metric => metric.name)).toEqual(['first']);

      upstream.emit(new _Metrics({name: 'second', timestampMillis: 2}));
      await new Promise(resolve => setTimeout(resolve, 5));
      const second = await batches.next();
      expect(second.value?.map(metric => metric.name)).toEqual(['second']);
      expect(first.value?.map(metric => metric.name)).toEqual(['first']);
    } finally {
      batcher.close();
      upstream.close();
      await batches.return();
    }
  });

  it('does not accumulate cancellation reactions for every item', async () => {
    const batcher = new Batcher({
      upstream: upstreamOf(Array.from({length: 20}, (_, index) => `${index}`)),
      batchSize: 1,
      batchAgeSeconds: 10,
    });
    const token = (batcher as unknown as {cancellationToken: CancellationToken})
      .cancellationToken;
    const originalThen = token.promise.then.bind(token.promise);
    const reactions: jest.SpyInstance[] = [];
    jest
      .spyOn(token.promise, 'then')
      .mockImplementation((onFulfilled, onRejected) => {
        const derived = originalThen(onFulfilled, onRejected);
        reactions.push(jest.spyOn(derived, 'then'));
        return derived;
      });
    const batches = batcher.consume();

    try {
      for (let index = 0; index < 20; index++) {
        expect((await batches.next()).value).toEqual([`${index}`]);
      }
      expect(
        reactions.reduce((count, spy) => count + spy.mock.calls.length, 0)
      ).toBeLessThanOrEqual(1);
    } finally {
      batcher.close();
      await batches.return();
    }
  });
});
