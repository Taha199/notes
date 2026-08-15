import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  label?: string;
};

type State = {
  error: Error | null;
};

/** Catches render crashes so one broken pane cannot blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-app-text dark:text-gray-100">Something went wrong</p>
        <p className="max-w-lg break-words text-[12px] text-app-text-secondary dark:text-gray-400">{message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-xl bg-primary px-4 py-2 text-[12px] font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }
}
