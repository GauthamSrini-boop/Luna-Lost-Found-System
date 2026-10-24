// NOTE: written but NOT executed in the authoring environment (vitest/RTL could not be installed: npm registry 403).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Field, LoadingBlock, Pagination } from '../../src/components/ui.jsx';

describe('shared UI states', () => {
  it('Badge always shows a text label, not just a colour', () => {
    render(<Badge status="claim_pending" />);
    expect(screen.getByText('Claim pending')).toBeInTheDocument();
  });
  it('LoadingBlock is announced politely', () => {
    render(<LoadingBlock label="Loading reports..." />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading reports...');
  });
  it('EmptyState renders title, message and action', () => {
    render(<EmptyState title="Nothing here" action={<button>Create</button>}>Try again later</EmptyState>);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Try again later')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
  it('ErrorState is an alert with a retry button', async () => {
    const retry = vi.fn();
    render(<ErrorState error={{ status: 0 }} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot reach the server/i);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('links label, control and error message for assistive tech', () => {
    render(<Field label="Title" error="Title is required" required>{(p) => <input {...p} />}</Field>);
    const input = screen.getByLabelText(/Title/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Title is required');
    expect(screen.getByRole('alert')).toHaveTextContent('Title is required');
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page and disables edge buttons', async () => {
    const { container, rerender } = render(<Pagination page={1} totalPages={1} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    const onPage = vi.fn();
    rerender(<Pagination page={1} totalPages={3} onPage={onPage} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('ConfirmDialog', () => {
  it('shows content only when open and wires confirm/cancel', async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog open={false} title="Withdraw?" onConfirm={onConfirm} onCancel={onCancel}>Body</ConfirmDialog>);
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    rerender(<ConfirmDialog open title="Withdraw?" confirmLabel="Yes" onConfirm={onConfirm} onCancel={onCancel}>Body</ConfirmDialog>);
    expect(screen.getByText('Body')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
