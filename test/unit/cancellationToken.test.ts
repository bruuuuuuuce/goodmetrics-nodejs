import {CancellationToken} from '../../src/goodmetrics/pipeline/cancellationToken';

describe('CancellationToken', () => {
  it('starts out not cancelled', () => {
    const token = new CancellationToken();
    expect(token.isCancelled()).toBe(false);
  });

  it('reports cancelled after cancel() is called', () => {
    const token = new CancellationToken();
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });

  it('resolves its promise to CANCEL once cancelled', async () => {
    const token = new CancellationToken();
    token.cancel();
    await expect(token.promise).resolves.toBe(CancellationToken.CANCEL);
  });
});
