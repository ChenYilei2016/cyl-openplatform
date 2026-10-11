import { beforeAll } from 'vitest';

// jsdom不实现原生对话框；这里只模拟open状态，焦点/Escape仍由真实浏览器验收。
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, writable: true,
      value(this: HTMLDialogElement) { this.open = false; },
    });
  }
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, writable: true,
      value(this: HTMLDialogElement) { this.open = true; },
    });
  }
});

// jsdom缺少响应式/布局观测；真实布局另由浏览器检查。
Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = element => getComputedStyle(element);
