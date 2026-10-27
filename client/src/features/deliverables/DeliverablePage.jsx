import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getJson, requestJson } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function DeliverablePage() {
  const { deliverableId } = useParams();
  const { user, csrfToken } = useAuth();
  const [detail, setDetail] = useState(null);
  const [comments, setComments] = useState([]);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [deliverableResult, commentResult] = await Promise.all([
        getJson(`/deliverables/${deliverableId}`),
        getJson(`/deliverables/${deliverableId}/comments`),
      ]);
      setDetail(deliverableResult);
      setComments(commentResult.comments);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [deliverableId]);

  useEffect(() => { load(); }, [load]);

  async function act(action, successMessage) {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function submitVersion(event) {
    event.preventDefault();
    const success = await act(() => requestJson(`/deliverables/${deliverableId}/submissions`, {
      method: 'POST', body: { url, notes }, csrfToken,
    }), 'Submission sent for client review.');
    if (success) { setUrl(''); setNotes(''); }
  }

  async function review(decision) {
    const current = detail.submissions[0];
    const success = await act(() => requestJson(`/submissions/${current.id}/review`, {
      method: 'POST', body: { decision, feedback: decision === 'revision_requested' ? feedback : '' }, csrfToken,
    }), decision === 'approved' ? 'Deliverable approved.' : 'Revision requested.');
    if (success) setFeedback('');
  }

  async function addComment(event) {
    event.preventDefault();
    const success = await act(() => requestJson(`/deliverables/${deliverableId}/comments`, {
      method: 'POST', body: { body: commentBody }, csrfToken,
    }), 'Comment added.');
    if (success) setCommentBody('');
  }

  if (!detail && !error) return <section className="page-content"><p className="muted">Loading deliverable…</p></section>;
  if (!detail) return <section className="page-content"><div className="alert alert-error" role="alert">{error}</div><Link to="/projects">Back to projects</Link></section>;

  const { deliverable, submissions } = detail;
  const currentSubmission = submissions[0];
  const projectOpen = !['completed', 'cancelled'].includes(deliverable.project.status);
  const milestoneOpen = deliverable.milestone.status !== 'completed';
  const canSubmit = projectOpen && milestoneOpen && (user.role === 'manager' || user.role === 'developer');
  const canReview = projectOpen && user.role === 'client' && deliverable.status === 'submitted' && currentSubmission;
  const canComment = projectOpen && milestoneOpen;

  return (
    <section className="page-content">
      <Link className="back-link" to={`/projects/${deliverable.project.id}`}>← {deliverable.project.name}</Link>
      <header className="page-heading">
        <div><p className="eyebrow">{deliverable.milestone.title}</p><h1>{deliverable.title}</h1><p className="muted">{deliverable.description || 'No description.'}</p></div>
        <span className={`status-badge status-${deliverable.status}`}>{deliverable.status.replaceAll('_', ' ')}</span>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {!projectOpen && <div className="alert" role="status">This project is closed. Delivery history is read-only.</div>}

      <section className="section-block review-target">
        <div className="section-heading"><div><p className="eyebrow">CURRENT REVIEW TARGET</p><h2>{currentSubmission ? `Version ${currentSubmission.versionNumber}` : 'No submission yet'}</h2></div></div>
        {currentSubmission ? (
          <div className="submission-current">
            <a className="submission-link" href={currentSubmission.url} target="_blank" rel="noreferrer">{currentSubmission.url}<span aria-hidden="true"> ↗</span></a>
            {currentSubmission.notes && <p>{currentSubmission.notes}</p>}
            <small>Submitted by {currentSubmission.submittedByName} · {new Date(currentSubmission.submittedAt).toLocaleString()}</small>
            {canReview && (
              <div className="review-actions">
                <label className="field review-feedback"><span>Feedback (required for revisions)</span><textarea rows="3" maxLength={5000} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>
                <div className="button-row">
                  <button className="button button-primary" disabled={busy} onClick={() => review('approved')}>Approve version {currentSubmission.versionNumber}</button>
                  <button className="button button-secondary" disabled={busy || !feedback.trim()} onClick={() => review('revision_requested')}>Request revision</button>
                </div>
              </div>
            )}
          </div>
        ) : <p className="muted">The delivery team has not submitted a version yet.</p>}
      </section>

      {canSubmit && ['draft', 'revision_requested'].includes(deliverable.status) && (
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">DELIVERY</p><h2>{deliverable.status === 'draft' ? 'Submit deliverable' : 'Submit revised version'}</h2></div></div>
          <form className="form-panel form-grid" onSubmit={submitVersion}>
            <label className="field field-wide"><span>HTTP/HTTPS URL</span><input type="url" required maxLength={2048} placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
            <label className="field field-wide"><span>Submission notes</span><textarea rows="3" maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="form-actions field-wide"><button className="button button-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit version'}</button></div>
          </form>
        </section>
      )}

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Submission history</h2></div><span>{submissions.length} versions</span></div>
        {submissions.length === 0 ? <p className="muted">No submitted versions.</p> : (
          <div className="history-list">
            {submissions.map((submission) => (
              <article className="history-row" key={submission.id}>
                <div className="history-version"><strong>v{submission.versionNumber}</strong><small>{new Date(submission.submittedAt).toLocaleString()}</small></div>
                <div className="history-detail"><a href={submission.url} target="_blank" rel="noreferrer">{submission.url}</a><p>{submission.notes || 'No submission notes.'}</p>
                  <small>Submitted by {submission.submittedByName}</small>
                  {submission.decision && <p className="review-outcome"><strong>{submission.decision.replaceAll('_', ' ')}</strong> by {submission.reviewerName} · {new Date(submission.reviewedAt).toLocaleString()}{submission.feedback && <span> · {submission.feedback}</span>}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">DISCUSSION</p><h2>Comments</h2></div><span>{comments.length}</span></div>
        {canComment && <form className="comment-form" onSubmit={addComment}>
          <label className="field"><span>Add a comment</span><textarea required rows="2" maxLength={5000} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} /></label>
          <button className="button button-secondary" disabled={busy || !commentBody.trim()}>Comment</button>
        </form>}
        <div className="comment-list">
          {comments.map((comment) => <article className="comment-row" key={comment.id}><strong>{comment.authorName}</strong><small>{new Date(comment.createdAt).toLocaleString()}</small><p>{comment.body}</p></article>)}
          {comments.length === 0 && <p className="muted">No comments yet.</p>}
        </div>
      </section>
    </section>
  );
}
