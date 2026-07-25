/**
 * Top-level error boundary.
 *
 * A render-time exception anywhere below this leaves React with no tree to show
 * and the user staring at a blank page. Catching it here turns that into a
 * recoverable screen — and, crucially, reassures the user their work is safe:
 * the document lives in IndexedDB, not in the component that just crashed, so a
 * reload reopens it. The error is logged for diagnosis.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import './error-boundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] Unhandled render error', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="qtm-crash" role="alert">
        <div className="qtm-crash-box">
          <h1>Something went wrong</h1>
          <p>
            The editor hit an unexpected error. Your songs are saved in this
            browser and were not affected — reloading should reopen the last one.
          </p>
          <button type="button" className="qtm-button qtm-button--primary" onClick={this.handleReload}>
            Reload the editor
          </button>
          {error.message && <pre className="qtm-crash-detail">{error.message}</pre>}
        </div>
      </div>
    );
  }
}
