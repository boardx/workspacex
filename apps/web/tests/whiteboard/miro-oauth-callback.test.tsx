import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MiroOAuthCallbackPage from '@/app/studio/board/miro/callback/page';
import { completeMiroOAuth } from '@/lib/live-whiteboard';

const replace = vi.fn();
let query = new URLSearchParams('state=one-time&code=authorization-code');
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => query }));
vi.mock('@/lib/live-whiteboard', () => ({ completeMiroOAuth: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  query = new URLSearchParams('state=one-time&code=authorization-code');
});
afterEach(cleanup);

describe('Miro OAuth browser callback', () => {
  it('exchanges the URL code through the authenticated API client then returns to the validated Board path', async () => {
    vi.mocked(completeMiroOAuth).mockResolvedValue({ returnTo: '/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80' });
    render(<MiroOAuthCallbackPage />);
    await waitFor(() => expect(completeMiroOAuth).toHaveBeenCalledWith({ state: 'one-time', code: 'authorization-code' }));
    expect(replace).toHaveBeenCalledWith('/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80?miro=connected');
  });
  it('shows a safe recovery message for missing callback parameters', async () => {
    query = new URLSearchParams('state=one-time');
    render(<MiroOAuthCallbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('返回白板并重新连接');
    expect(completeMiroOAuth).not.toHaveBeenCalled();
  });
  it('does not expose API details or navigate after a rejected one-time state', async () => {
    vi.mocked(completeMiroOAuth).mockRejectedValue(new Error('secret remote response'));
    render(<MiroOAuthCallbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('返回白板并重新连接');
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret remote response');
    expect(replace).not.toHaveBeenCalled();
  });
});
