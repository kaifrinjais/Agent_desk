import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { getJson, requestJson } from '../../api/http.js';
import ProjectsPage from './ProjectsPage.jsx';

vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/http.js', () => ({ getJson: vi.fn(), requestJson: vi.fn() }));

describe('project management page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { id: 1, fullName: 'Morgan Manager', role: 'manager' } });
    getJson.mockImplementation(async (path) => {
      if (path === '/projects') return { projects: [] };
      if (path === '/clients') return { clients: [{ id: 3, name: 'Northstar', isActive: true }] };
      if (path === '/projects/managers') return { managers: [{ id: 1, fullName: 'Morgan Manager' }] };
      return { developers: [] };
    });
    requestJson.mockResolvedValue({ project: { id: 12 } });
  });

  it('submits a manager-created project using numeric relationship IDs and date-only values', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    await user.type(screen.getByLabelText('Project name'), 'Northstar Portal');
    await user.selectOptions(screen.getByLabelText('Client organization'), '3');
    await user.selectOptions(screen.getByLabelText('Project manager'), '1');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(requestJson).toHaveBeenCalledWith('/projects', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        name: 'Northstar Portal', clientId: 3, projectManagerId: 1,
        startDate: '2026-11-01', dueDate: '2026-12-01',
      }),
    })));
  });
});