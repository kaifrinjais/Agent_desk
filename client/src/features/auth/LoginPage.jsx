import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login({ email, password });
      navigate(user.mustChangePassword ? '/password' : '/projects');
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
        <p className="eyebrow">CLIENT DELIVERY WORKSPACE</p>
        <h1>Sign in</h1>
        <p className="muted">Use your AgencyDesk account to continue.</p>
        <label className="field">
          <span>Email</span>
          <input autoComplete="username" type="email" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input autoComplete="current-password" type="password" required maxLength={128}
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <span className="login-footnote">AgencyDesk · Secure client collaboration</span>
    </main>
  );
}