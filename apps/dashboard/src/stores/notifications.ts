import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  createdAt: number;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (type: NotificationType, title: string, message?: string) => void;
  removeNotification: (id: string) => void;
}

let counter = 0;
const MAX_NOTIFICATIONS = 10;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  addNotification: (type, title, message) => {
    const id = `notif-${++counter}`;
    set((s) => {
      const updated = [...s.notifications, { id, type, title, message, createdAt: Date.now() }];
      // Cap at MAX_NOTIFICATIONS to prevent unbounded memory growth
      return { notifications: updated.length > MAX_NOTIFICATIONS ? updated.slice(-MAX_NOTIFICATIONS) : updated };
    });
    // Auto-dismiss after 5s
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    }, 5000);
  },

  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
}));
