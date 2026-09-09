import React, { useState, useEffect } from 'react';

export default function App() {
  const [apiHealth, setApiHealth] = useState({ loading: true, data: null, error: null });
  const [dbHealth, setDbHealth] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => setApiHealth({ loading: false, data, error: null }))
      .catch((err) => setApiHealth({ loading: false, data: null, error: err.message }));

    fetch('/api/v1/health/db')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => setDbHealth({ loading: false, data, error: null }))
      .catch((err) => setDbHealth({ loading: false, data: null, error: err.message }));
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-slate-800 rounded-xl shadow-2xl border border-slate-700 p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-sky-400">E-Learning Platform</h1>
          <p className="text-slate-400 text-sm mt-1">Day 2: Database Schema & Connection Pool Setup</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">Express API Status</h2>
            {apiHealth.loading ? (
              <span className="text-amber-400 text-sm font-medium animate-pulse">Checking API...</span>
            ) : apiHealth.error ? (
              <span className="text-rose-400 text-sm font-medium">Offline: {apiHealth.error}</span>
            ) : (
              <div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Online
                </span>
                <p className="text-xs text-slate-400 mt-2">{apiHealth.data.message}</p>
              </div>
            )}
          </div>

          <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">PostgreSQL DB Status</h2>
            {dbHealth.loading ? (
              <span className="text-amber-400 text-sm font-medium animate-pulse">Checking DB...</span>
            ) : dbHealth.error ? (
              <span className="text-rose-400 text-sm font-medium">Disconnected: {dbHealth.error}</span>
            ) : (
              <div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Connected ({dbHealth.data.database})
                </span>
                <p className="text-xs text-slate-400 mt-2">{dbHealth.data.message}</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700 pt-4 flex justify-between items-center text-xs text-slate-500">
          <span>Backend: http://localhost:5000</span>
          <span>Database: PostgreSQL 16</span>
        </div>
      </div>
    </div>
  );
}