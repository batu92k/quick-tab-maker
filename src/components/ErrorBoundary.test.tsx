// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// React needs this flag to accept `act` when no test framework has set it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders its children when they do not throw', () => {
    const root = createRoot(container);
    act(() => root.render(<ErrorBoundary><p>all good</p></ErrorBoundary>));
    expect(container.textContent).toContain('all good');
    act(() => root.unmount());
  });

  it('shows the recovery screen and the error message when a child throws', () => {
    // React logs caught errors; silence the expected noise for a clean run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = createRoot(container);
    act(() => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));

    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('kaboom');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    act(() => root.unmount());
    spy.mockRestore();
  });
});
