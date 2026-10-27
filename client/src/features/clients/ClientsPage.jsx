import { useEffect, useState } from 'react';
import { getJson, requestJson } from '../../api/http.js';

const blankClient = { name: '', contactEmail: '', description: '' };

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(blankClient);
  const [userForms, setUserForms] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blankClient);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await getJson('/clients');
      setClients(result.clients);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createClient(event) {
    event.preventDefault();
    setError('');
    try {
      await requestJson('/clients', { method: 'POST', body: form });
      setForm(blankClient);
      setShowForm(false);
      setNotice('Client organization created.');
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function beginEdit(client) {
    setEditingId(client.id);
    setEditForm({
      name: client.name,
      contactEmail: client.contactEmail ?? '',
      description: client.description ?? '',
      isActive: client.isActive,
    });
  }

  async function updateClient(event, clientId) {
    event.preventDefault();
    setError('');
    try {
      await requestJson(`/clients/${clientId}`, { method: 'PATCH', body: editForm });
      setEditingId(null);
      setNotice('Client organization updated.');
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function updateUserForm(clientId, field, value) {
    setUserForms((current) => ({
      ...current,
      [clientId]: { fullName: '', email: '', temporaryPassword: '', ...current[clientId], [field]: value },
    }));
  }

  async function createUser(event, clientId) {
    event.preventDefault();
    setError('');
    try {
      await requestJson(`/clients/${clientId}/users`, {
        method: 'POST', body: userForms[clientId],
      });
      setNotice('Client account created. Share its temporary password securely.');
      setUserForms((current) => ({ ...current, [clientId]: { fullName: '', email: '', temporaryPassword: '' } }));
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <section className="page-content">
      <header className="page-heading">
        <div><p className="eyebrow">AGENCY DIRECTORY</p><h1>Clients</h1><p className="muted">Organizations and their client accounts</p></div>
        <button className="button button-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'New client'}</button>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}<button className="alert-dismiss" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
      {showForm && (
        <form className="form-panel form-grid" onSubmit={createClient}>
          <div className="panel-heading field-wide"><h2>New organization</h2></div>
          <label className="field"><span>Organization name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>Contact email</span><input type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} /></label>
          <label className="field field-wide"><span>Description</span><textarea rows="3" maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="form-actions field-wide"><button className="button button-primary">Create organization</button></div>
        </form>
      )}
      {loading ? <p className="muted">Loading clients…</p> : clients.length === 0 ? (
        <div className="empty-state"><h2>No client organizations</h2><p>Create a client organization to start a project.</p></div>
      ) : (
        <div className="client-list">
          {clients.map((client) => (
            <article className="client-row" key={client.id}>
              <div className="client-summary">
                <span className="client-mark" aria-hidden="true">{client.name.slice(0, 1).toUpperCase()}</span>
                <div><h2>{client.name}</h2><p>{client.contactEmail || 'No contact email'} · {client.projectCount} projects · {client.userCount} users</p></div>
                <span className={`status-badge ${client.isActive ? 'status-active' : 'status-cancelled'}`}>{client.isActive ? 'Active' : 'Inactive'}</span>
                <button className="button button-secondary client-edit-button" onClick={() => beginEdit(client)}>Edit</button>
              </div>
              {editingId === client.id && (
                <form className="form-grid compact-form" onSubmit={(event) => updateClient(event, client.id)}>
                  <label className="field"><span>Organization name</span><input required maxLength={120} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
                  <label className="field"><span>Contact email</span><input type="email" value={editForm.contactEmail} onChange={(event) => setEditForm({ ...editForm, contactEmail: event.target.value })} /></label>
                  <label className="field field-wide"><span>Description</span><textarea rows="2" maxLength={2000} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></label>
                  <label className="check-field field-wide"><input type="checkbox" checked={editForm.isActive} onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })} /><span>Organization is active</span></label>
                  <div className="form-actions field-wide"><button className="button button-primary">Save changes</button></div>
                </form>
              )}
              <details className="inline-disclosure">
                <summary>Create client account</summary>
                <form className="form-grid compact-form" onSubmit={(event) => createUser(event, client.id)}>
                  <label className="field"><span>Full name</span><input required maxLength={120} value={userForms[client.id]?.fullName ?? ''} onChange={(event) => updateUserForm(client.id, 'fullName', event.target.value)} /></label>
                  <label className="field"><span>Email</span><input type="email" required value={userForms[client.id]?.email ?? ''} onChange={(event) => updateUserForm(client.id, 'email', event.target.value)} /></label>
                  <label className="field"><span>Temporary password</span><input type="password" required minLength={12} maxLength={72} value={userForms[client.id]?.temporaryPassword ?? ''} onChange={(event) => updateUserForm(client.id, 'temporaryPassword', event.target.value)} /></label>
                  <div className="form-actions"><button className="button button-secondary">Create account</button></div>
                </form>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}