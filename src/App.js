import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import './App.css';

const API = 'https://web-production-c4605.up.railway.app';
const SESSION_KEY = 'hc_admin_session';

const inputStyle = {
  width: '100%', background: '#151820', border: '1px solid #2A2F42', borderRadius: 8,
  padding: '10px 12px', color: '#F1F5F9', fontSize: 13, outline: 'none', boxSizing: 'border-box'
};

function LoginScreen({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/login`, { login, password });
      const employee = res.data.employee;
      if (employee.role !== 'admin') {
        setError('Доступ к панели управления только для администраторов');
        return;
      }
      onLogin(employee);
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080A0F' }}>
      <form onSubmit={submit} style={{ background: '#0E1117', border: '1px solid #2A2F42', borderRadius: 12, padding: 28, width: 300 }}>
        <div style={{ color: '#F1F5F9', fontWeight: 800, fontSize: 16, marginBottom: 18, textAlign: 'center', letterSpacing: '0.04em' }}>🛡 HARD COLLECTION</div>
        <input placeholder="Логин" value={login} onChange={e => setLogin(e.target.value)} style={inputStyle} autoFocus />
        <input placeholder="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 8, background: '#3B82F6', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(false);

  const applySession = (employee) => {
    axios.defaults.headers.common['x-employee-id'] = employee.id;
    setAdmin(employee);
  };

  const handleLogout = React.useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    delete axios.defaults.headers.common['x-employee-id'];
    setAdmin(null);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try { applySession(JSON.parse(stored)); } catch (e) {}
    }
    setReady(true);

    // Если сессия отозвана/невалидна на бэкенде — выкидываем на экран входа,
    // а не оставляем крутиться с 401/403 на каждом запросе.
    const id = axios.interceptors.response.use(
      res => res,
      err => {
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
          handleLogout();
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, [handleLogout]);

  const handleLogin = (employee) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(employee));
    applySession(employee);
  };

  if (!ready) return null;
  if (!admin) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">🛡 HARD COLLECTION</div>
        <div className="nav-tabs">
          <button
            className={`nav-tab ${tab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setTab('dashboard')}
          >🖥 Дашборд</button>
          <button
            className={`nav-tab ${tab === 'admin' ? 'active' : ''}`}
            onClick={() => setTab('admin')}
          >⚙️ Управление</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="nav-live">
            <span className="live-dot" />
            LIVE
          </div>
          <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid #2A2F42', color: '#475569', borderRadius: 7, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>Выйти</button>
        </div>
      </nav>
      {tab === 'dashboard' ? <Dashboard /> : <AdminPanel />}
    </div>
  );
}

export default App;
