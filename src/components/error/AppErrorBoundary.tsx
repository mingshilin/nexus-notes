import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  description?: string;
  resetLabel?: string;
  resetKey?: string | number | null;
  className?: string;
  fullScreen?: boolean;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: "" });
    }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(error);
  }

  private reset = () => {
    this.setState({ hasError: false, message: "" });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.title ?? "应用遇到问题";
    const description = this.props.description ?? "这个区域暂时无法渲染。你可以重试，或刷新页面恢复到最新状态。";
    const resetLabel = this.props.resetLabel ?? "重试";
    const fullScreen = this.props.fullScreen ?? true;

    return (
      <div
        className={cn(
          fullScreen
            ? "flex min-h-screen items-center justify-center bg-[var(--surface-editor)] p-4"
            : "flex h-full min-h-[18rem] items-center justify-center p-4",
          this.props.className,
        )}
      >
        <div className="surface-card w-full max-w-xl rounded-[24px] border border-destructive/25 p-6 text-left shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-destructive">Error boundary</div>
          <h2 className="mt-2 text-xl font-semibold text-destructive">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          {this.state.message ? (
            <pre className="mt-4 max-h-28 overflow-auto rounded-[14px] bg-muted/70 p-3 text-xs text-muted-foreground">
              {this.state.message}
            </pre>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button className="rounded-[12px]" onClick={this.reset}>
              {resetLabel}
            </Button>
            {fullScreen ? (
              <Button variant="outline" className="rounded-[12px]" onClick={() => window.location.reload()}>
                刷新页面
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

export function PageErrorBoundary(props: Omit<ErrorBoundaryProps, "fullScreen">) {
  return <AppErrorBoundary {...props} fullScreen={false} />;
}
