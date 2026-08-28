import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ORDERS_AUTO render failure', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="startup-fallback app-failure" role="alert">
          <strong>ORDERS_AUTO не смог продолжить работу</strong>
          <p>
            Перезагрузите файл приложения. Если ошибка повторяется, скачайте свежий
            ORDERS_AUTO.html и сообщите, на каком действии возник сбой.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
