import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { Home, User, Settings, PlusCircle, Search, LogOut, Menu, X, Heart, Hash, MoreHorizontal } from 'lucide-react';
import { ProfilePage } from './ProfilePage';
import { AdminPanel } from './AdminPanel';
import { HomePage } from './HomePage';
import { AuthPage } from './AuthPage';
import { SearchPage, HashtagsPage, MorePage } from './ExtraPages';
import { MockDataProvider, useMockData } from '../services/mockData';

// Navigation Component
const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useMockData();

  const navItems = [
    // Trailing slashes match the canonical URLs (Cloudflare Pages serves
    // /route/ and 308-redirects /route), so internal links never redirect.
    { name: 'Home', icon: Home, path: '/' },
    { name: 'Search', icon: Search, path: '/search/' },
    { name: 'Hashtags', icon: Hash, path: '/hashtags/' },
    ...(user ? [{ name: 'Favorites', icon: Heart, path: '/favorites/' }] : []),
    ...(user?.role === 'ADMIN' ? [{ name: 'Admin', icon: Settings, path: '/admin/' }] : []),
    { name: 'More', icon: MoreHorizontal, path: '/more/' },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-black border-b border-red-900/50 px-4 py-3 flex items-center justify-between">
        <Link to="/" aria-label="FansLeak home" className="flex items-center gap-2">
          <img src="/logo.svg" alt="FansLeak logo" width="28" height="28" className="h-7 w-7" />
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-600 to-red-400">
            FansLeak
          </span>
        </Link>
        <button onClick={() => setIsOpen(!isOpen)} className="p-2 text-red-500">
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar / Drawer */}
      <nav className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-black border-r border-red-900/40 transform transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:h-screen
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          <div className="p-6 hidden md:block">
            <Link to="/" aria-label="FansLeak home" className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="FansLeak logo" width="32" height="32" className="h-8 w-8" />
              <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-600 to-red-400">
                FansLeak
              </span>
            </Link>
          </div>

          <div className="flex-1 px-4 space-y-2 mt-16 md:mt-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                (item.path === '/'
                  ? location.pathname === '/' || location.pathname === ''
                  : location.pathname.replace(/\/+$/, '') === item.path.replace(/\/+$/, ''));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
                    isActive 
                      ? 'bg-red-900/30 text-red-400 font-medium' 
                      : 'text-gray-400 hover:bg-red-900/20 hover:text-red-400'
                  }`}
                >
                  <Icon size={20} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>

          <div className="p-4 border-t border-red-900/40">
            {user ? (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-red-900/40 flex items-center justify-center text-red-400 font-bold">
                    {user.email[0].toUpperCase()}
                  </div>
                  <div className="text-sm">
                    <p className="font-medium text-gray-200">{user.email.split('@')[0]}</p>
                    <p className="text-xs text-gray-500 capitalize">{user.role.toLowerCase()}</p>
                  </div>
                </div>
                <button onClick={logout} className="text-gray-500 hover:text-red-500">
                  <LogOut size={18} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/70 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

// Layout Wrapper
const Layout = ({ children }: { children?: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen bg-black">
      <Navbar />
      <main className="flex-1 w-full max-w-full md:max-w-[calc(100vw-16rem)] min-h-screen overflow-x-hidden pt-16 md:pt-0">
        {children}
      </main>
    </div>
  );
};

const ProtectedRoute = ({ children, requireAdmin = false }: { children?: React.ReactNode, requireAdmin?: boolean }) => {
  const { user } = useMockData();
  
  if (!user) return <Navigate to="/auth/" replace />;
  if (requireAdmin && user.role !== 'ADMIN') return <Navigate to="/" />;
  
  return <>{children}</>;
};

export default function App() {
  useEffect(() => {
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const blockMediaDrag = (event: DragEvent) => {
      if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
        event.preventDefault();
      }
    };

    const blockSaveShortcuts = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Prevent the most common browser save/view-source shortcuts.
      if (commandKey && (key === 's' || key === 'u')) {
        event.preventDefault();
      }
    };

    document.addEventListener('contextmenu', blockContextMenu, true);
    document.addEventListener('dragstart', blockMediaDrag, true);
    document.addEventListener('keydown', blockSaveShortcuts, true);

    return () => {
      document.removeEventListener('contextmenu', blockContextMenu, true);
      document.removeEventListener('dragstart', blockMediaDrag, true);
      document.removeEventListener('keydown', blockSaveShortcuts, true);
    };
  }, []);

  return (
    <MockDataProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/hashtags" element={<HashtagsPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/profile/:id" element={<ProfilePage />} />
            <Route path="/favorites" element={
              <ProtectedRoute>
                <HomePage showFavoritesOnly />
              </ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin>
                <AdminPanel />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </MockDataProvider>
  );
}