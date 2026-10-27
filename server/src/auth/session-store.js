import session from 'express-session';

const { Store } = session;

function expiryTime(sessionData) {
  const cookieExpiry = sessionData.cookie?.expires;
  if (cookieExpiry) return new Date(cookieExpiry).getTime();
  return Date.now() + (sessionData.cookie?.maxAge ?? 8 * 60 * 60 * 1000);
}

export async function createSqliteSessionStore(database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);

  class SqliteSessionStore extends Store {
    get(sessionId, callback) {
      database.get('SELECT sess, expires_at FROM sessions WHERE sid = ?;', sessionId)
        .then(async (row) => {
          if (!row) return callback(null, null);
          if (row.expires_at <= Date.now()) {
            await this.destroy(sessionId, (error) => {
              if (error) callback(error);
              else callback(null, null);
            });
            return;
          }
          callback(null, JSON.parse(row.sess));
        })
        .catch(callback);
    }

    set(sessionId, sessionData, callback = () => {}) {
      database.run(
        `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at;`,
        sessionId,
        JSON.stringify(sessionData),
        expiryTime(sessionData),
      ).then(() => callback(null)).catch(callback);
    }

    touch(sessionId, sessionData, callback = () => {}) {
      database.run(
        'UPDATE sessions SET sess = ?, expires_at = ? WHERE sid = ?;',
        JSON.stringify(sessionData),
        expiryTime(sessionData),
        sessionId,
      ).then(() => callback(null)).catch(callback);
    }

    destroy(sessionId, callback = () => {}) {
      database.run('DELETE FROM sessions WHERE sid = ?;', sessionId)
        .then(() => callback(null)).catch(callback);
    }
  }

  return new SqliteSessionStore();
}