import {SynchronizingBuffer} from '../../src/goodmetrics/pipeline/synchronizingBuffer';
import {_Metrics} from '../../src/goodmetrics/_Metrics';

function metric(name: string): _Metrics {
  return new _Metrics({name, timestampMillis: 1});
}

describe('SynchronizingBuffer', () => {
  it('yields already-queued items without waiting', async () => {
    const buffer = new SynchronizingBuffer();
    buffer.emit(metric('a'));
    buffer.emit(metric('b'));

    const iterator = buffer.consume();
    const first = await iterator.next();
    const second = await iterator.next();

    // emit() pushes and consume() pops, so this is LIFO, not FIFO.
    expect(first.value?.name).toBe('b');
    expect(second.value?.name).toBe('a');

    buffer.close();
  });

  it('wakes up a pending consumer when a new item is emitted', async () => {
    const buffer = new SynchronizingBuffer();
    const iterator = buffer.consume();

    const pending = iterator.next();
    buffer.emit(metric('late'));

    const result = await pending;
    expect(result.value?.name).toBe('late');

    buffer.close();
  });

  it('trims the oldest items once the queue exceeds queueSize', async () => {
    const buffer = new SynchronizingBuffer({queueSize: 2});
    buffer.emit(metric('first'));
    buffer.emit(metric('second'));
    buffer.emit(metric('third'));

    const iterator = buffer.consume();
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      const {value} = await iterator.next();
      if (value) {
        names.push(value.name);
      }
    }

    expect(names).toEqual(['third', 'second']);
    buffer.close();
  });

  it('stops consume() once closed', async () => {
    const buffer = new SynchronizingBuffer();
    const iterator = buffer.consume();

    const pending = iterator.next();
    buffer.close();

    const result = await pending;
    expect(result.done).toBe(true);
  });
});
