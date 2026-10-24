import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom does not implement <dialog>.showModal()/close(); minimal polyfill so ConfirmDialog can be tested.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ||= function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ||= function close() { this.removeAttribute('open'); };
}
