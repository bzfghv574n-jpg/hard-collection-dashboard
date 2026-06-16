import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import './App.css';

function App() {
  const [tab, setTab] = useState('dashboard');

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
        <div className="nav-live">
          <span className="live-dot" />
          LIVE
        </div>
      </nav>
      {tab === 'dashboard' ? <Dashboard /> : <AdminPanel />}
    </div>
  );
}

export default App;
