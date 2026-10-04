import { useState, useEffect } from 'react';
import api from '../../api/axios';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.notifications || []);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  const handleMarkAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-300 hover:text-white transition"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-2 z-50 text-slate-100">
          <div className="px-4 py-2 font-bold text-xs uppercase tracking-wider text-slate-400 border-b border-slate-700 flex justify-between">
            <span>Notifications</span>
            <span>{unreadCount} Unread</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No notifications.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.notification_id}
                  className={`px-4 py-3 border-b border-slate-700/50 flex justify-between items-start text-xs ${
                    n.is_read ? 'opacity-60 bg-slate-800' : 'bg-slate-700/40'
                  }`}
                >
                  <div className="pr-2">
                    <p className="text-slate-200">{n.message}</p>
                    <span className="text-[10px] text-slate-400">
                      {new Date(n.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkAsRead(n.notification_id)}
                      className="text-[10px] text-indigo-400 hover:underline shrink-0"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}