import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getJson, requestJson } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

const blankMilestone = { title: '', description: '', position: '', startDate: '', dueDate: '' };
const blankRequest = { title: '', description: '', estimatedExtraDays: '' };

function labelStatus(value) {
  return value.replaceAll('_', ' ');
}

const projectTransitions = {
  planning: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['planning', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

const milestoneTransitions = {
  manager: {
    not_started: ['in_progress', 'blocked'],
    in_progress: ['blocked', 'completed'],
    blocked: ['in_progress'],
    completed: [],
  },
  developer: {
    not_started: ['in_progress'],
    in_progress: ['blocked'],
    blocked: ['in_progress'],
    completed: [],
  },
};

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const { user, csrfToken } = useAuth();
  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [deliverables, setDeliverables] = useState({});
  const [members, setMembers] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [managers, setManagers] = useState([]);
  const [changeRequests, setChangeRequests] = useState([]);
  const [activity, setActivity] = useState([]);
  const [milestoneForm, setMilestoneForm] = useState(blankMilestone);
  const [milestoneEditForms, setMilestoneEditForms] = useState({});
  const [projectForm, setProjectForm] = useState(null);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [developerId, setDeveloperId] = useState('');
  const [deliverableDrafts, setDeliverableDrafts] = useState({});
  const [decisionNotes, setDecisionNotes] = useState({});
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [projectResult, milestoneResult, requestResult, activityResult] = await Promise.all([
        getJson(`/projects/${projectId}`),
        getJson(`/projects/${projectId}/milestones`),
        getJson(`/projects/${projectId}/change-requests`),
        getJson(`/projects/${projectId}/activity?limit=50`),
      ]);
      setProject(projectResult.project);
      setProjectForm({
        name: projectResult.project.name,
        description: projectResult.project.description,
        startDate: projectResult.project.startDate ?? '',
        dueDate: projectResult.project.dueDate ?? '',
        projectManagerId: String(projectResult.project.projectManagerId),
      });
      setMilestones(milestoneResult.milestones);
      setChangeRequests(requestResult.changeRequests);
      setActivity(activityResult.activity);
      const results = await Promise.all(milestoneResult.milestones.map((milestone) => (
        getJson(`/milestones/${milestone.id}/deliverables`)
      )));
      setDeliverables(Object.fromEntries(milestoneResult.milestones.map((milestone, index) => (
        [milestone.id, results[index].deliverables]
      ))));
      if (user.role === 'manager') {
        const [memberResult, developerResult, managerResult] = await Promise.all([
          getJson(`/projects/${projectId}/members`), getJson('/projects/developers'), getJson('/projects/managers'),
        ]);
        setMembers(memberResult.members);
        setDevelopers(developerResult.developers);
        setManagers(managerResult.managers);
      } else if (user.role === 'developer') {
        const memberResult = await getJson(`/projects/${projectId}/members`);
        setMembers(memberResult.members);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, user.role]);

  useEffect(() => { load(); }, [load]);

  async function runAction(action, successMessage) {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await load();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  }

  async function createMilestone(event) {
    event.preventDefault();
    const success = await runAction(() => requestJson(`/projects/${projectId}/milestones`, {
      method: 'POST', body: {
        ...milestoneForm,
        position: Number(milestoneForm.position),
        startDate: milestoneForm.startDate || null,
        dueDate: milestoneForm.dueDate || null,
      }, csrfToken,
    }), 'Milestone created.');
    if (success) {
      setMilestoneForm(blankMilestone);
      setShowMilestoneForm(false);
    }
  }

  async function updateMilestone(milestone, status) {
    await runAction(() => requestJson(`/milestones/${milestone.id}`, {
      method: 'PATCH', body: { status }, csrfToken,
    }), 'Milestone updated.');
  }

  async function createDeliverable(event, milestone) {
    event.preventDefault();
    const draft = deliverableDrafts[milestone.id] ?? { title: '', description: '' };
    const success = await runAction(() => requestJson(`/milestones/${milestone.id}/deliverables`, {
      method: 'POST', body: draft, csrfToken,
    }), 'Deliverable created.');
    if (success) setDeliverableDrafts((current) => ({ ...current, [milestone.id]: { title: '', description: '' } }));
  }

  async function assignDeveloper(event) {
    event.preventDefault();
    const success = await runAction(() => requestJson(`/projects/${projectId}/members`, {
      method: 'POST', body: { developerId: Number(developerId) }, csrfToken,
    }), 'Developer assigned.');
    if (success) setDeveloperId('');
  }

  async function createChangeRequest(event) {
    event.preventDefault();
    const success = await runAction(() => requestJson(`/projects/${projectId}/change-requests`, {
      method: 'POST', body: {
        ...requestForm,
        estimatedExtraDays: requestForm.estimatedExtraDays === '' ? null : Number(requestForm.estimatedExtraDays),
      }, csrfToken,
    }), 'Change request submitted.');
    if (success) setRequestForm(blankRequest);
  }

  async function changeRequestDecision(changeRequest, status) {
    const success = await runAction(() => requestJson(`/change-requests/${changeRequest.id}/decision`, {
      method: 'PATCH',
      body: { status, decisionNotes: decisionNotes[changeRequest.id] ?? '' },
      csrfToken,
    }), status === 'under_review' ? 'Request moved to review.' : `Request ${status}.`);
    if (success) setDecisionNotes((current) => ({ ...current, [changeRequest.id]: '' }));
  }

  async function updateProjectStatus(status) {
    await runAction(() => requestJson(`/projects/${projectId}`, {
      method: 'PATCH', body: { status }, csrfToken,
    }), 'Project status updated.');
  }

  async function updateProject(event) {
    event.preventDefault();
    await runAction(() => requestJson(`/projects/${projectId}`, {
      method: 'PATCH',
      body: {
        ...projectForm,
        projectManagerId: Number(projectForm.projectManagerId),
        startDate: projectForm.startDate || null,
        dueDate: projectForm.dueDate || null,
      },
      csrfToken,
    }), 'Project updated.');
  }

  function milestoneEdit(milestone) {
    return milestoneEditForms[milestone.id] ?? {
      title: milestone.title,
      description: milestone.description,
      position: String(milestone.position),
      startDate: milestone.startDate ?? '',
      dueDate: milestone.dueDate ?? '',
    };
  }

  async function saveMilestone(event, milestone) {
    event.preventDefault();
    const values = milestoneEdit(milestone);
    await runAction(() => requestJson(`/milestones/${milestone.id}`, {
      method: 'PATCH',
      body: {
        ...values,
        position: Number(values.position),
        startDate: values.startDate || null,
        dueDate: values.dueDate || null,
      },
      csrfToken,
    }), 'Milestone details updated.');
  }

  async function removeDeveloper(member) {
    await runAction(() => requestJson(`/projects/${projectId}/members/${member.id}`, {
      method: 'DELETE', csrfToken,
    }), 'Developer unassigned.');
  }

  if (loading) return <section className="page-content"><p className="muted">Loading project…</p></section>;
  if (!project) return <section className="page-content"><div className="alert alert-error" role="alert">{error || 'Project unavailable.'}</div><Link to="/projects">Back to projects</Link></section>;

  const canWork = user.role === 'manager' || user.role === 'developer';
  const canManage = user.role === 'manager';
  const canRequestChange = user.role === 'client';
  const projectOpen = !['completed', 'cancelled'].includes(project.status);

  return (
    <section className="page-content">
      <Link className="back-link" to="/projects">← Projects</Link>
      <header className="page-heading project-heading">
        <div>
          <p className="eyebrow">{project.clientName}</p>
          <h1>{project.name}</h1>
          <p className="muted">{project.description || 'No project description.'}</p>
        </div>
        <div className="heading-actions">
          {canManage && <label className="status-select"><span className="sr-only">Project status</span>
            <select value={project.status} onChange={(event) => updateProjectStatus(event.target.value)}>
              {[project.status, ...projectTransitions[project.status]].map((status) => (
                <option key={status} value={status}>{labelStatus(status)}</option>
              ))}
            </select>
          </label>}
          {canManage && <button className="button button-secondary" onClick={() => setShowProjectForm((value) => !value)}>{showProjectForm ? 'Close edit' : 'Edit project'}</button>}
          {!canManage && <span className={`status-badge status-${project.status}`}>{labelStatus(project.status)}</span>}
        </div>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {canManage && showProjectForm && projectForm && (
        <form className="form-panel form-grid" onSubmit={updateProject}>
          <div className="panel-heading field-wide"><h2>Edit project</h2><span>Client organization cannot be changed</span></div>
          <label className="field"><span>Project name</span><input required maxLength={160} value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label>
          <label className="field"><span>Project manager</span><select required value={projectForm.projectManagerId} onChange={(event) => setProjectForm({ ...projectForm, projectManagerId: event.target.value })}>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}</select></label>
          <label className="field"><span>Start date</span><input type="date" value={projectForm.startDate} onChange={(event) => setProjectForm({ ...projectForm, startDate: event.target.value })} /></label>
          <label className="field"><span>Due date</span><input type="date" value={projectForm.dueDate} onChange={(event) => setProjectForm({ ...projectForm, dueDate: event.target.value })} /></label>
          <label className="field field-wide"><span>Description</span><textarea rows="3" maxLength={5000} value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} /></label>
          <div className="form-actions field-wide"><button className="button button-primary">Save project</button></div>
        </form>
      )}

      <div className="project-meta-strip">
        <span><small>Start</small>{project.startDate || 'Not set'}</span>
        <span><small>Due</small>{project.dueDate || 'Not set'}</span>
        <span><small>Client</small>{project.clientName}</span>
      </div>

      {canManage && projectOpen && (
        <section className="section-block">
          <div className="section-heading"><h2>Project team</h2><span>{members.length} developers</span></div>
          <div className="team-list">
            {members.map((member) => (
              <span className="team-chip" key={member.id}>
                <span>{member.fullName}<small>{member.email}</small></span>
                <button className="icon-button remove-member" type="button" title={`Unassign ${member.fullName}`}
                  aria-label={`Unassign ${member.fullName}`} onClick={() => removeDeveloper(member)}>×</button>
              </span>
            ))}
          </div>
          <form className="inline-form" onSubmit={assignDeveloper}>
            <label className="field"><span>Assign developer</span>
              <select required value={developerId} onChange={(event) => setDeveloperId(event.target.value)}>
                <option value="">Select a developer</option>
                {developers.filter((developer) => !members.some((member) => member.id === developer.id))
                  .map((developer) => <option key={developer.id} value={developer.id}>{developer.fullName}</option>)}
              </select>
            </label>
            <button className="button button-secondary" disabled={!developerId}>Assign</button>
          </form>
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">DELIVERY PLAN</p><h2>Milestones</h2></div>
          {canManage && projectOpen && <button className="button button-secondary" onClick={() => setShowMilestoneForm((value) => !value)}>{showMilestoneForm ? 'Close' : 'Add milestone'}</button>}
        </div>
        {showMilestoneForm && canManage && projectOpen && (
          <form className="form-panel form-grid compact-form" onSubmit={createMilestone}>
            <label className="field"><span>Title</span><input required maxLength={160} value={milestoneForm.title} onChange={(event) => setMilestoneForm({ ...milestoneForm, title: event.target.value })} /></label>
            <label className="field"><span>Position</span><input required type="number" min="0" value={milestoneForm.position} onChange={(event) => setMilestoneForm({ ...milestoneForm, position: event.target.value })} /></label>
            <label className="field"><span>Start date</span><input type="date" value={milestoneForm.startDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, startDate: event.target.value })} /></label>
            <label className="field"><span>Due date</span><input type="date" value={milestoneForm.dueDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, dueDate: event.target.value })} /></label>
            <label className="field field-wide"><span>Description</span><textarea rows="2" maxLength={5000} value={milestoneForm.description} onChange={(event) => setMilestoneForm({ ...milestoneForm, description: event.target.value })} /></label>
            <div className="form-actions field-wide"><button className="button button-primary">Create milestone</button></div>
          </form>
        )}
        {milestones.length === 0 ? <p className="muted">No milestones have been created.</p> : (
          <div className="milestone-list">
            {milestones.map((milestone) => (
              <article className="milestone-row" key={milestone.id}>
                <div className="milestone-topline">
                  <div><span className="milestone-order">{String(milestone.position).padStart(2, '0')}</span><h3>{milestone.title}</h3></div>
                  {projectOpen && (canManage || user.role === 'developer') && (
                    <label className="status-select"><span className="sr-only">Milestone status</span>
                      <select disabled={milestone.status === 'completed'} value={milestone.status} onChange={(event) => updateMilestone(milestone, event.target.value)}>
                        {[milestone.status, ...milestoneTransitions[user.role][milestone.status]]
                          .map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}
                      </select>
                    </label>
                  )}
                  {user.role === 'client' && <span className={`status-badge status-${milestone.status}`}>{labelStatus(milestone.status)}</span>}
                </div>
                {milestone.description && <p className="muted">{milestone.description}</p>}
                {canManage && projectOpen && milestone.status !== 'completed' && (
                  <details className="inline-disclosure milestone-edit">
                    <summary>Edit milestone details</summary>
                    <form className="form-grid compact-form" onSubmit={(event) => saveMilestone(event, milestone)}>
                      <label className="field"><span>Title</span><input required maxLength={160} value={milestoneEdit(milestone).title} onChange={(event) => setMilestoneEditForms((current) => ({ ...current, [milestone.id]: { ...milestoneEdit(milestone), title: event.target.value } }))} /></label>
                      <label className="field"><span>Position</span><input type="number" min="0" required value={milestoneEdit(milestone).position} onChange={(event) => setMilestoneEditForms((current) => ({ ...current, [milestone.id]: { ...milestoneEdit(milestone), position: event.target.value } }))} /></label>
                      <label className="field"><span>Start date</span><input type="date" value={milestoneEdit(milestone).startDate} onChange={(event) => setMilestoneEditForms((current) => ({ ...current, [milestone.id]: { ...milestoneEdit(milestone), startDate: event.target.value } }))} /></label>
                      <label className="field"><span>Due date</span><input type="date" value={milestoneEdit(milestone).dueDate} onChange={(event) => setMilestoneEditForms((current) => ({ ...current, [milestone.id]: { ...milestoneEdit(milestone), dueDate: event.target.value } }))} /></label>
                      <label className="field field-wide"><span>Description</span><textarea rows="2" maxLength={5000} value={milestoneEdit(milestone).description} onChange={(event) => setMilestoneEditForms((current) => ({ ...current, [milestone.id]: { ...milestoneEdit(milestone), description: event.target.value } }))} /></label>
                      <div className="form-actions field-wide"><button className="button button-secondary">Save milestone</button></div>
                    </form>
                  </details>
                )}
                <div className="deliverable-list">
                  {(deliverables[milestone.id] ?? []).map((deliverable) => (
                    <Link className="deliverable-row" to={`/deliverables/${deliverable.id}`} key={deliverable.id}>
                      <span>{deliverable.title}</span><span className={`status-badge status-${deliverable.status}`}>{labelStatus(deliverable.status)}</span>
                    </Link>
                  ))}
                  {canWork && projectOpen && milestone.status !== 'completed' && (
                    <details className="inline-disclosure">
                      <summary>Add deliverable</summary>
                      <form className="form-grid compact-form" onSubmit={(event) => createDeliverable(event, milestone)}>
                        <label className="field"><span>Title</span><input required maxLength={160}
                          value={deliverableDrafts[milestone.id]?.title ?? ''}
                          onChange={(event) => setDeliverableDrafts((current) => ({ ...current, [milestone.id]: { title: event.target.value, description: current[milestone.id]?.description ?? '' } }))} /></label>
                        <label className="field"><span>Description</span><input maxLength={5000}
                          value={deliverableDrafts[milestone.id]?.description ?? ''}
                          onChange={(event) => setDeliverableDrafts((current) => ({ ...current, [milestone.id]: { title: current[milestone.id]?.title ?? '', description: event.target.value } }))} /></label>
                        <button className="button button-secondary">Create</button>
                      </form>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">SCOPE</p><h2>Change requests</h2></div></div>
        {canRequestChange && projectOpen && (
          <form className="form-panel form-grid compact-form" onSubmit={createChangeRequest}>
            <label className="field"><span>Request title</span><input required maxLength={160} value={requestForm.title} onChange={(event) => setRequestForm({ ...requestForm, title: event.target.value })} /></label>
            <label className="field"><span>Estimated extra days</span><input type="number" min="0" max="3650" value={requestForm.estimatedExtraDays} onChange={(event) => setRequestForm({ ...requestForm, estimatedExtraDays: event.target.value })} /></label>
            <label className="field field-wide"><span>Description</span><textarea required rows="3" maxLength={5000} value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} /></label>
            <div className="form-actions field-wide"><button className="button button-primary">Submit change request</button></div>
          </form>
        )}
        <div className="change-request-list">
          {changeRequests.length === 0 ? <p className="muted">No change requests.</p> : changeRequests.map((item) => (
            <article className="change-request-row" key={item.id}>
              <div className="change-request-heading"><div><h3>{item.title}</h3><p>{item.description}</p></div><span className={`status-badge status-${item.status}`}>{labelStatus(item.status)}</span></div>
              <p className="muted request-meta">Requested by {item.requestedByName} · {new Date(item.createdAt).toLocaleString()} · {item.estimatedExtraDays ?? 'No'} extra days estimated</p>
              {item.decisionNotes && <p className="decision-note">{item.decisionByName} · {item.decidedAt ? new Date(item.decidedAt).toLocaleString() : ''} · {item.decisionNotes}</p>}
              {canManage && item.status === 'submitted' && <button className="button button-secondary" onClick={() => changeRequestDecision(item, 'under_review')}>Start review</button>}
              {canManage && item.status === 'under_review' && (
                <div className="decision-actions">
                  <label className="field"><span>Decision notes</span><input required value={decisionNotes[item.id] ?? ''} onChange={(event) => setDecisionNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                  <button className="button button-primary" disabled={!decisionNotes[item.id]?.trim()} onClick={() => changeRequestDecision(item, 'approved')}>Approve</button>
                  <button className="button button-danger" disabled={!decisionNotes[item.id]?.trim()} onClick={() => changeRequestDecision(item, 'rejected')}>Reject</button>
                </div>
              )}
              {canRequestChange && item.requestedBy === user.id && ['submitted', 'under_review'].includes(item.status) && (
                <button className="text-button" onClick={() => runAction(() => requestJson(`/change-requests/${item.id}/withdraw`, { method: 'POST', body: {}, csrfToken }), 'Request withdrawn.')}>Withdraw request</button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">PROJECT RECORD</p><h2>Activity</h2></div></div>
        {activity.length === 0 ? <p className="muted">No recorded activity.</p> : (
          <ol className="activity-list">
            {activity.map((event) => (
              <li key={event.id}><span className="activity-mark" aria-hidden="true" />
                <div><strong>{event.actorName || 'System'} · {event.action.replaceAll('.', ' ')}</strong>
                  <small>{new Date(event.createdAt).toLocaleString()}</small></div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
