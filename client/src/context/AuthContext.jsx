import { createContext, useContext, useEffect, useState } from 'react';
import { requestJson } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [csrfToken, setCsrfToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const csrf = await requestJson('/auth/csrf');
        if (active) setCsrfToken(csrf.csrfToken);
        const current = await requestJson('/auth/me');
        if (active) setUser(current.user);
      } catch (error) {
        if (active && error.status !== 401) {
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    initialize();
    return () => { active = false; };
  }, []);

  async function login(credentials) {
    const currentCsrf = csrfToken ?? (await requestJson('/auth/csrf')).csrfToken;
    const result = await requestJson('/auth/login', {
      method: 'POST', body: credentials, csrfToken: currentCsrf,
    });
    setUser(result.user);
    setCsrfToken(result.csrfToken);
    return result.user;
  }

  async function logout() {
    await requestJson('/auth/logout', { method: 'POST', body: {}, csrfToken });
    setUser(null);
    setCsrfToken(null);
  }

  async function changePassword(passwords) {
    const result = await requestJson('/auth/change-password', {
      method: 'POST', body: passwords, csrfToken,
    });
    setUser(result.user);
    setCsrfToken(result.csrfToken);
    return result.user;
  }

  return (
    <AuthContext.Provider value={{ user, csrfToken, loading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}