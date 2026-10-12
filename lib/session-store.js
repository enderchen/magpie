// SQLite session storage using the application's supported driver.
// Keep the existing connect-sqlite3 sessions(sid, expired, sess) format.
const { Store } = require('express-session');
const sqlite3 = require('sqlite3');
const path = require('path');
const ONE_DAY = 86400000;

class SQLiteStore extends Store {
  constructor({ db = 'sessions.sqlite', dir = '.' } = {}) {
    super();
    this.db = new sqlite3.Database(db === ':memory:' ? db : path.join(dir, db));
    this.ready = new Promise((resolve, reject) => {
      this.db.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS sessions (sid PRIMARY KEY, expired, sess)', error => error ? reject(error) : resolve());
    });
    this.ready.catch(() => {}); // initApp and operations observe startup failures.
    this.timer = setInterval(() => {
      this.ready.then(() => this.db.run('DELETE FROM sessions WHERE expired < ?', [Date.now()], () => {}), () => {});
    }, ONE_DAY);
    this.timer.unref();
  }

  expiry(session) {
    const expires = session.cookie?.expires && new Date(session.cookie.expires).getTime();
    if (Number.isFinite(expires)) return expires;
    const maxAge = session.cookie?.maxAge;
    return Date.now() + (Number.isFinite(maxAge) ? maxAge : ONE_DAY);
  }

  get(sid, callback) {
    this.ready.then(() => this.db.get('SELECT sess FROM sessions WHERE sid = ? AND expired >= ?', [sid, Date.now()], (error, row) => {
      if (error || !row) return callback(error || null, null);
      let session;
      try { session = JSON.parse(row.sess); } catch (e) { return callback(e); }
      callback(null, session);
    }), callback);
  }

  set(sid, session, callback = () => {}) {
    let text, expired;
    try { text = JSON.stringify(session); expired = this.expiry(session); }
    catch (e) { callback(e); return; }
    this.ready.then(() => this.db.run('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)', [sid, expired, text], callback), callback);
  }

  touch(sid, session, callback = () => {}) {
    this.ready.then(() => this.db.run('UPDATE sessions SET expired = ? WHERE sid = ? AND expired >= ?', [this.expiry(session), sid, Date.now()], callback), callback);
  }

  destroy(sid, callback = () => {}) {
    this.ready.then(() => this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], callback), callback);
  }

  clear(callback = () => {}) {
    this.ready.then(() => this.db.run('DELETE FROM sessions', callback), callback);
  }

  length(callback) {
    this.ready.then(() => this.db.get('SELECT COUNT(*) AS count FROM sessions WHERE expired >= ?', [Date.now()], (error, row) => callback(error, row?.count)), callback);
  }

  all(callback) {
    this.ready.then(() => this.db.all('SELECT sess FROM sessions WHERE expired >= ?', [Date.now()], (error, rows) => {
      if (error) return callback(error);
      let sessions;
      try { sessions = rows.map(row => JSON.parse(row.sess)); } catch (e) { return callback(e); }
      callback(null, sessions);
    }), callback);
  }

  close(callback = () => {}) {
    clearInterval(this.timer);
    this.ready.then(() => this.db.close(callback), () => this.db.close(callback));
  }
}

module.exports = SQLiteStore;
