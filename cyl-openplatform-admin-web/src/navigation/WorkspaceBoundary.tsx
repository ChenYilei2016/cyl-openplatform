import { Component, type ReactNode } from 'react';
import { Button, Result } from 'antd';

/** 页面chunk或渲染失败只影响当前工作区，保留外层导航和会话。 */
export default class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section role="alert">
        <Result
          status="warning"
          title="工作区暂时无法显示"
          subTitle="请重新加载当前页面，或从左侧导航进入其他工作区。"
          extra={
            <Button onClick={() => window.location.reload()}>
              重新加载页面
            </Button>
          }
        />
      </section>
    ) : (
      this.props.children
    );
  }
}
