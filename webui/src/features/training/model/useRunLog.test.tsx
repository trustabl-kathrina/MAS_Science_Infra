import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunLog } from './useRunLog';

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.latest = this; }
  addEventListener(type: string, fn: (event: { data: string }) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  close() {}
  emit(type: string, payload: unknown) {
    this.listeners[type]?.forEach(fn => fn({ data: JSON.stringify(payload) }));
  }
}

function block(text: string, generation: string, reset = false) {
  return {
    offset: 0, next_offset: text.length, size: text.length, text, generation, reset, terminal: false,
  };
}

afterEach(() => { FakeEventSource.latest = null; vi.unstubAllGlobals(); });

describe('useRunLog', () => {
  it('appends stdout and clears the previous generation on reset', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { result } = renderHook(() => useRunLog('exp', 'run-1', true));
    await waitFor(() => expect(FakeEventSource.latest).toBeTruthy());
    FakeEventSource.latest?.emit('stdout', block('hello\n', 'g1'));
    await waitFor(() => expect(result.current.lines.map(line => line.text).join('\n')).toContain('hello'));
    FakeEventSource.latest?.emit('stdout', block('world\n', 'g2', true));
    await waitFor(() => expect(result.current.lines.map(line => line.text)).toEqual(['world']));
    expect(result.current.lines.map(line => line.text).join('\n')).not.toContain('hello');
  });
});
