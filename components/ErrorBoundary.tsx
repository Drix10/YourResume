import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    // TODO: Send to error tracking service (Sentry, etc.)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#181B26] flex items-center justify-center p-4">
          <div className="bg-[#1f2330] border-2 border-[#EF5350] rounded-lg max-w-md w-full p-8">
            <h1 className="text-2xl font-serif font-bold text-[#F4F4F0] mb-4">
              ⚠️ Something Went Wrong
            </h1>
            <p className="text-[#a0a09a] mb-4">
              We encountered an unexpected error. This has been logged and we'll
              look into it.
            </p>
            {this.state.error && (
              <div className="bg-[#232838] border border-[#3e4559] rounded p-3 mb-4 font-mono text-xs text-[#EF5350] overflow-auto max-h-32">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full bg-[#EF5350] hover:bg-[#D34542] text-white px-5 py-3 rounded font-serif font-bold transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
