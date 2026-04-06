import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { NotificationToast } from '@/components/shared/NotificationToast';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'TheMatrix - Multi-Agent Cluster Dashboard',
  description: 'Monitor and manage your multi-agent workflow orchestration system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground min-h-screen antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-auto p-6">
                {children}
              </main>
            </div>
          </div>
          <CommandPalette />
          <NotificationToast />
        </Providers>
      </body>
    </html>
  );
}
