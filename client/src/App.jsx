import React, { useState, useEffect } from 'react';

export default function App() {
  const [healthStatus, setHealthStatus] = useState({
    loading: true,
    data: null,
    error: null
  });

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setHealthStatus({ loading: false, data: data, error: null });
      })
      .catch((err) => {
        setHealthStatus({ loading: false, data: null, error: err.message });
      });
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-800 rounded-xl shadow-2xl border border-slate-700 p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-sky-400">E-Learning Platform</h1>
          <span className="px-3 py-1 bg-sky-950 text-sky-300 text-xs font-semibold rounded-full border border-sky-800">
            Day 1 Setup
          </span>
        </div>

        <p className="text-slate-300 mb-6 text-sm">
          Monorepo workspace initialized. Node.js ES Modules server and React Vite client with Tailwind CSS are operational.
        </p>

        <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">
              Backend API Status (/api/v1/health)
            </span>
            {healthStatus.loading && (
              <span className="text-xs text-amber-400 font-medium animate-pulse">Connecting...</span>
            )}
            {!healthStatus.loading && healthStatus.data && (
              <span className="text-xs text-emerald-400 font-medium">Online</span>
            )}
            {!healthStatus.loading && healthStatus.error && (
              <span className="text-xs text-rose-400 font-medium">Offline</span>
            )}
          </div>

          {healthStatus.loading && (
            <p className="text-slate-500 text-xs italic">Requesting health check from Express backend...</p>
          )}

          {!healthStatus.loading && healthStatus.data && (
            <pre className="text-xs font-mono text-emerald-300 bg-slate-900 p-3 rounded border border-slate-800 overflow-x-auto">
              {JSON.stringify(healthStatus.data, null, 2)}
            </pre>
          )}

          {!healthStatus.loading && healthStatus.error && (
            <div className="p-3 bg-rose-950/50 border border-rose-900 rounded text-rose-300 text-xs">
              <strong>Connection Error:</strong> {healthStatus.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}