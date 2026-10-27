CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  contact_email TEXT,
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'developer', 'client')),
  client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (role = 'client' AND client_id IS NOT NULL)
    OR (role IN ('manager', 'developer') AND client_id IS NULL)
  )
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  start_date TEXT,
  due_date TEXT,
  project_manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (client_id, name),
  CHECK (start_date IS NULL OR date(start_date) IS NOT NULL),
  CHECK (due_date IS NULL OR date(due_date) IS NOT NULL),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);

CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  assigned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK (position >= 0),
  start_date TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'blocked', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, position),
  CHECK (start_date IS NULL OR date(start_date) IS NOT NULL),
  CHECK (due_date IS NULL OR date(due_date) IS NOT NULL),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);

CREATE TABLE deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id INTEGER NOT NULL REFERENCES milestones(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'revision_requested', 'approved')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE deliverable_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  url TEXT NOT NULL CHECK (lower(url) LIKE 'http://%' OR lower(url) LIKE 'https://%'),
  notes TEXT NOT NULL DEFAULT '',
  submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (deliverable_id, version_number)
);

CREATE TABLE deliverable_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES deliverable_submissions(id) ON DELETE RESTRICT,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'revision_requested')),
  feedback TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (decision <> 'revision_requested' OR length(trim(feedback)) > 0)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE RESTRICT,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  estimated_extra_days INTEGER CHECK (estimated_extra_days IS NULL OR estimated_extra_days >= 0),
  decision_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  decision_notes TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (status IN ('approved', 'rejected') AND decision_by IS NOT NULL
      AND decision_notes IS NOT NULL AND length(trim(decision_notes)) > 0 AND decided_at IS NOT NULL)
    OR (status IN ('submitted', 'under_review', 'withdrawn')
      AND decision_by IS NULL AND decision_notes IS NULL AND decided_at IS NULL)
  )
);

CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_client_id ON users(client_id);
CREATE INDEX idx_projects_client_id ON projects(client_id);
CREATE INDEX idx_projects_project_manager_id ON projects(project_manager_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_project_members_user_id ON project_members(user_id);
CREATE INDEX idx_milestones_project_position ON milestones(project_id, position);
CREATE INDEX idx_deliverables_milestone_id ON deliverables(milestone_id);
CREATE INDEX idx_submissions_deliverable_version ON deliverable_submissions(deliverable_id, version_number);
CREATE INDEX idx_change_requests_project_status ON change_requests(project_id, status);
CREATE INDEX idx_activity_project_created ON activity_logs(project_id, created_at);