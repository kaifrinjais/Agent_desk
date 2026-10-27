import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';
import PasswordChangePage from './PasswordChangePage.jsx';

vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));

function renderAt(element, initialPath = '/login', passwordElement = <p>Password route reached</p>) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={element} />
        <Route path="/password" element={passwordElement} />
        <Route path="/projects" element={<p>Projects route reached</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('authentication screens', () => {
  beforeEach(() => {
    useAuth.mockReset();
  });

  it('submits credentials and sends forced-password users to the password form', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue({ mustChangePassword: true });
    useAuth.mockReturnValue({ login });
    renderAt(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'client@example.test');
    await user.type(screen.getByLabelText('Password'), 'temporary-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith({ email: 'client@example.test', password: 'temporary-password' });
    expect(await screen.findByText('Password route reached')).toBeInTheDocument();
  });

  it('shows recoverable login errors without clearing entered credentials', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ login: vi.fn().mockRejectedValue(new Error('Email or password is incorrect.')) });
    renderAt(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'manager@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Email')).toHaveValue('manager@example.test');
    expect(screen.getByLabelText('Password')).toHaveValue('wrong-password');
  });

  it('submits the forced password change and continues to projects', async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn().mockResolvedValue({});
    useAuth.mockReturnValue({ changePassword });
    renderAt(<PasswordChangePage />, '/password', <PasswordChangePage />);

    await user.type(screen.getByLabelText('Current password'), 'temporary-password');
    await user.type(screen.getByLabelText('New password'), 'new-long-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'temporary-password', newPassword: 'new-long-password',
    });
    expect(await screen.findByText('Projects route reached')).toBeInTheDocument();
  });
});