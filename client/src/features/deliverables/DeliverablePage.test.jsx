import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { getJson, requestJson } from '../../api/http.js';
import DeliverablePage from './DeliverablePage.jsx';

vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/http.js', () => ({ getJson: vi.fn(), requestJson: vi.fn() }));

describe('deliverable review page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { id: 4, role: 'client' }, csrfToken: 'csrf-token' });
    getJson.mockImplementation(async (path) => {
      if (path.endsWith('/comments')) return { comments: [] };
      return {
        deliverable: {
          id: 9, title: 'Navigation', description: 'Navigation prototype', status: 'submitted',
          project: { id: 1, name: 'Website Refresh' }, milestone: { title: 'Design review' },
        },
        submissions: [{
          id: 21, versionNumber: 1, url: 'https://example.test/navigation', notes: '',
          submittedByName: 'Developer', submittedAt: '2026-10-27T00:00:00Z',
        }],
      };
    });
    requestJson.mockResolvedValue({ review: { decision: 'revision_requested' } });
  });

  it('requires revision feedback before reviewing and targets the current version', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/deliverables/9']}>
        <Routes><Route path="/deliverables/:deliverableId" element={<DeliverablePage />} /></Routes>
      </MemoryRouter>,
    );

    const revisionButton = await screen.findByRole('button', { name: 'Request revision' });
    expect(revisionButton).toBeDisabled();
    await user.type(screen.getByLabelText('Feedback (required for revisions)'), 'Please adjust mobile spacing.');
    expect(revisionButton).toBeEnabled();
    await user.click(revisionButton);

    await waitFor(() => expect(requestJson).toHaveBeenCalledWith('/submissions/21/review', {
      method: 'POST',
      body: { decision: 'revision_requested', feedback: 'Please adjust mobile spacing.' },
      csrfToken: 'csrf-token',
    }));
  });
});