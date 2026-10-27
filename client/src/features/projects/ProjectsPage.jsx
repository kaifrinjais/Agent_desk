import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJson, requestJson } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

const emptyProject = {
  clientId: '', name: '', description: '', projectManagerId: '', startDate: '', dueDate: '',
};

function dateLabel(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : 'No date set';
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [managers, setManagers] = useState([]);
  const [form, setForm] = useState(emptyProject);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getJson('/projects');
      setProjects(result.projects);
      if (user.role === 'manager') {
        const [clientResult, managerResult] = await Promise.all([
          getJson('/clients'), getJson('/projects/managers'),
        ]);
        setClients(clientResult.clients.filter((client) => client.isActive));
        setManagers(managerResult.managers);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [user.role]);

  useEffect(() => { load(); }, [load]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function createProject(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await requestJson('/projects', {
        method: 'POST',
        body: {
          ...form,
          clientId: Number(form.clientId),
          projectManagerId: Number(form.projectManagerId),
          startDate: form.startDate || null,
          dueDate: form.dueDate || null,
        },
      });
      setForm(emptyProject);
      setShowForm(false);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-content">
      <header className="page-heading">
        <div>
          <p className="eyebrow">DELIVERY WORKSPACE</p>
          <h1>Projects</h1>
          <p className="muted">{projects.length} projects available to you</p>
        </div>
        {user.role === 'manager' && (
          <button className="button button-primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Close form' : 'New project'}
          </button>
        )}
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {showForm && user.role === 'manager' && (
        <form className="form-panel form-grid" onSubmit={createProject}>
          <div className="panel-heading"><h2>Create project</h2><span>Manager access</span></div>
          <label className="field"><span>Project name</span><input name="name" required maxLength={160} value={form.name} onChange={updateForm} /></label>
          <label className="field"><span>Client organization</span>
            <select name="clientId" required value={form.clientId} onChange={updateForm}>
              <option value="">Select a client</option>
              {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="field field-wide"><span>Description</span><textarea name="description" rows="3" maxLength={5000} value={form.description} onChange={updateForm} /></label>
          <label className="field"><span>Project manager</span>
            <select name="projectManagerId" required value={form.projectManagerId} onChange={updateForm}>
              <option value="">Select a manager</option>
              {managers.map((manager) => (
                <option value={manager.id} key={manager.id}>{manager.fullName}{manager.id === user.id ? ' (you)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Start date</span><input type="date" name="startDate" value={form.startDate} onChange={updateForm} /></label>
          <label className="field"><span>Due date</span><input type="date" name="dueDate" value={form.dueDate} onChange={updateForm} /></label>
          <div className="form-actions field-wide">
            <button className="button button-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create project'}</button>
          </div>
        </form>
      )}

      {loading ? <p className="muted">Loading projects…</p> : projects.length === 0 ? (
        <div className="empty-state"><h2>No projects yet</h2><p>Projects available to your account will appear here.</p></div>
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <Link className="project-row" to={`/projects/${project.id}`} key={project.id}>
              <span className="project-main">
                <strong>{project.name}</strong>
                <small>{project.clientName} · Due {dateLabel(project.dueDate)}</small>
              </span>
              <span className={`status-badge status-${project.status}`}>{project.status.replaceAll('_', ' ')}</span>
              <span className="row-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}