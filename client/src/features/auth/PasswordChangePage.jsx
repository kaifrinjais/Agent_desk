import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function PasswordChangePage() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      navigate('/projects');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <a className="wordmark" href="/">
        <span className="wordmark-mark" aria-hidden="true">A</span>AgencyDesk
      </a>
      <form className="login-panel" onSubmit={submit}>
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>Set a new password</h1>
        <p className="muted">A new password is required before viewing project information.</p>
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" required maxLength={128}
            value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" required minLength={12} maxLength={72}
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={submitting}>
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </main>
  );
}