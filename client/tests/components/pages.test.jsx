// NOTE: written but NOT executed in the authoring environment (vitest/RTL/react-router could not be installed: npm registry 403).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../src/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), upload: vi.fn() }, ApiError: class extends Error {} }));
import { api } from '../../src/api.js';
import { AuthProvider } from '../../src/context/AuthContext.jsx';
import { ToastProvider } from '../../src/context/ToastContext.jsx';
import { Login, Register } from '../../src/pages/Auth.jsx';
import Browse from '../../src/pages/Browse.jsx';
import { RequireAuth } from '../../src/components/Layout.jsx';

const wrap = (ui, path = '/') => render(
  <MemoryRouter initialEntries={[path]}><ToastProvider><AuthProvider>{ui}</AuthProvider></ToastProvider></MemoryRouter>,
);
const student = { id: 1, email: 'a@b.co', full_name: 'Alice A', role: 'student', is_active: 1 };

beforeEach(() => { vi.clearAllMocks(); api.get.mockImplementation(async (url) => (url === '/api/auth/me' ? { user: null, unread: 0 } : url === '/api/meta' ? { categories: [], locations: [] } : {})); });

describe('Login form', () => {
  it('shows required-field messages without calling the server', async () => {
    wrap(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('shows the server error for bad credentials', async () => {
    api.post.mockRejectedValueOnce(Object.assign(new Error('Invalid email or password'), { status: 401 }));
    wrap(<Login />);
    await userEvent.type(screen.getByLabelText(/Email/), 'a@b.co');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('Register form', () => {
  it('flags a password mismatch', async () => {
    wrap(<Register />);
    await userEvent.type(screen.getByLabelText(/Full name/), 'Alice A');
    await userEvent.type(screen.getByLabelText(/Campus email/), 'a@b.co');
    await userEvent.type(screen.getAllByLabelText(/Password/)[0], 'Secret123');
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'Different1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });
});

describe('Browse states', () => {
  const setup = (reports) => {
    api.get.mockImplementation(async (url) => (url === '/api/auth/me' ? { user: student, unread: 0 } : url === '/api/meta' ? { categories: [], locations: [] } : reports()));
    wrap(<Routes><Route path="/browse" element={<Browse />} /></Routes>, '/browse');
  };
  it('shows a loading indicator, then results', async () => {
    setup(async () => ({ items: [{ type: 'lost', id: 1, title: 'Red bag', description: 'd', category: 'Bags', location: 'Library', event_date: '2026-01-01', status: 'open', is_mine: false }], total: 1, page: 1, total_pages: 1 }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('Red bag')).toBeInTheDocument();
    expect(screen.getByText('1 report found')).toBeInTheDocument();
  });
  it('shows an empty state when nothing matches', async () => {
    setup(async () => ({ items: [], total: 0, page: 1, total_pages: 1 }));
    expect(await screen.findByText('No reports match your search')).toBeInTheDocument();
  });
  it('shows an error state with retry when the API fails', async () => {
    setup(async () => { throw Object.assign(new Error('x'), { status: 500 }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/our side/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('route guard', () => {
  it('redirects signed-out visitors to the login page', async () => {
    wrap(<Routes><Route path="/login" element={<div>login page</div>} /><Route path="/secret" element={<RequireAuth><div>secret</div></RequireAuth>} /></Routes>, '/secret');
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });
  it('sends users without the right role to the unauthorized page', async () => {
    api.get.mockImplementation(async (url) => (url === '/api/auth/me' ? { user: student, unread: 0 } : {}));
    wrap(<Routes><Route path="/unauthorized" element={<div>no access</div>} /><Route path="/admin" element={<RequireAuth roles={['admin']}><div>admin</div></RequireAuth>} /></Routes>, '/admin');
    await waitFor(() => expect(screen.getByText('no access')).toBeInTheDocument());
  });
});
