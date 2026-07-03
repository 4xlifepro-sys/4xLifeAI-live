import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Home as HomeIcon, User, Share2, Sparkles, Cpu, LifeBuoy, Activity, LogOut, Shield, MoreVertical, Menu, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import NotificationDropdown from './components/NotificationDropdown';

import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Account from './pages/Account';
import Referrals from './pages/Referrals';
import Admin from './pages/Admin';
import ValidationAnalytics from './pages/ValidationAnalytics';
import Trades from './pages/Trades';
import Plans from './pages/Plans';
import AICoach from './pages/AICoach';
import Support from './pages/Support';
import Signals from './pages/Signals';
import TodaySignals from './pages/TodaySignals';
import LoadingScreen from './components/LoadingScreen';
import { Logo } from './components/Logo';

import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function GlobalLayout() {
  const location = useLocation();
  const { user, isAdmin, signOut, loading } = useAuth();
  const isAuthPage = location.pathname.startsWith('/login') || location.pathname.startsWith('/signup') || location.pathname.startsWith('/forgot-password') || location.pathname.startsWith('/reset-password');
  
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforePrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforePrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforePrompt);
    };
  }, []);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const installApp = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const promise = deferredPrompt.userChoice || deferredPrompt.waitForUserChoice;
      if (promise) {
        promise.then(() => {
          setDeferredPrompt(null);
        });
      } else {
        setDeferredPrompt(null);
      }
    }
  };

  // Close more menu on click outside or navigation
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.more-menu-container')) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setIsMoreMenuOpen(false);
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  if (loading) {
    return <LoadingScreen />;
  }

  const primaryNavItems = user ? [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/today-signals', label: 'TODAY\'S SIGNALS', icon: Activity },
    { path: '/plans', label: 'Plans', icon: Sparkles },
    { path: '/ai-coach', label: 'AI Coach', icon: Cpu },
    { path: '/account', label: 'Account', icon: User },
    ...(isAdmin ? [{ path: '/admin', label: 'Admin', icon: Shield }] : []),
  ] : [
    { path: '/', label: 'Home', icon: HomeIcon },
    { path: '/plans', label: 'Plans', icon: Sparkles },
    { path: '/support', label: 'Support', icon: LifeBuoy },
  ];

  const mobileNavItems = user ? [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/today-signals', label: "Today's Signals", icon: Activity },
    { path: '/plans', label: 'Plans', icon: Sparkles },
    { path: '/ai-coach', label: 'AI Coach', icon: Cpu },
    { path: '/account', label: 'Account', icon: User },
    ...(isAdmin ? [{ path: '/admin', label: 'Admin', icon: Shield }] : []),
  ] : [
    { path: '/', label: 'Home', icon: HomeIcon },
    { path: '/plans', label: 'Plans', icon: Sparkles },
    { path: '/support', label: 'Support', icon: LifeBuoy },
  ];

  const moreNavItems = user ? [
    { path: '/trades', label: 'Trade Monitor', icon: Activity },
    { path: '/validation', label: 'Validation', icon: Activity },
    { path: '/referrals', label: 'Referrals', icon: Share2 },
    { path: '/support', label: 'Support', icon: LifeBuoy },
  ] : [];

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#E0E4EA] font-sans antialiased flex flex-col">
      {/* Top Banner with Developer Name */}
      <div className="bg-[#05080E] border-b border-[#202735]/60 py-2.5 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-teal-500/5 to-blue-500/5 pointer-events-none" />
        <p className="text-xs text-[#8A95A5] font-sans tracking-wider flex flex-wrap items-center justify-center gap-2 relative z-10">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-black text-[10px] uppercase tracking-widest border border-blue-500/20">
            ★ LEAD DEVELOPER
          </span>
          <span className="font-semibold text-slate-300">System Engineered By</span>
          <span className="text-white font-black text-sm tracking-widest uppercase hover:text-blue-400 transition-colors drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]">
            Tofik Mohammed
          </span>
        </p>
      </div>

      <nav className="border-b border-[#202735] bg-[#11141A]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to={user ? "/dashboard" : "/"} className="flex items-center">
              <Logo size={32} showText={true} />
            </Link>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex flex-1 justify-end min-w-0">
              <div className="flex items-center pr-4 space-x-1 sm:space-x-4">
                {primaryNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors duration-200 whitespace-nowrap",
                      location.pathname === item.path
                        ? "text-blue-400"
                        : "text-[#8A95A5] hover:text-white"
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                ))}
                
                {user && (
                  <div className="relative more-menu-container flex items-center">
                    <button
                      onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors duration-200 whitespace-nowrap",
                        isMoreMenuOpen ? "text-blue-400" : "text-[#8A95A5] hover:text-white"
                      )}
                    >
                      <MoreVertical className="w-5 h-5 shrink-0" />
                    </button>
                    
                    {isMoreMenuOpen && (
                      <div className="absolute top-full right-0 mt-1 w-48 bg-[#11141A] border border-[#202735] rounded-xl shadow-2xl overflow-hidden py-1 z-50">
                        {moreNavItems.map((item) => (
                          <Link
                            key={item.path}
                            to={item.path}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-200",
                              location.pathname === item.path
                                ? "bg-blue-600/10 text-blue-400"
                                : "text-[#8A95A5] hover:bg-[#1A1E26] hover:text-white"
                            )}
                            onClick={() => setIsMoreMenuOpen(false)}
                          >
                            <item.icon className="w-4 h-4" />
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex items-center shrink-0 border-l border-[#202735] pl-4">
                {!user && !isAuthPage && (
                  <div className="hidden sm:flex items-center space-x-3">
                    <Link
                      to="/login"
                      className="px-4 py-1.5 text-sm font-bold text-white hover:text-blue-400 transition-colors uppercase"
                    >
                      Login
                    </Link>
                    <Link
                      to="/signup"
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold tracking-wide rounded shadow-[0_0_15px_rgba(37,99,235,0.4)] transition-all uppercase"
                    >
                      Sign Up
                    </Link>
                  </div>
                )}

                {user && (
                   <div className="flex items-center gap-4">
                     <div className="hidden sm:block text-right">
                        <div className="text-sm font-bold text-white">{user.user_metadata?.full_name || 'Trader'}</div>
                        <div className="text-xs text-[#5D6B80]">{user.email}</div>
                     </div>
                     <NotificationDropdown />
                     <button 
                       onClick={signOut}
                       className="p-2 text-[#8A95A5] hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                       title="Logout"
                     >
                       <LogOut className="w-4 h-4" />
                     </button>
                   </div>
                )}
              </div>
            </div>

            {/* Mobile Navigation controls */}
            <div className="flex md:hidden items-center gap-3">
              {user && <NotificationDropdown />}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-[#8A95A5] hover:text-white hover:bg-white/5 rounded-lg transition-colors focus:outline-none"
                aria-label="Toggle Menu"
              >
                {isMobileMenuOpen ? (
                  <X className="w-6 h-6 shrink-0" />
                ) : (
                  <Menu className="w-6 h-6 shrink-0" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu Dropdown Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 h-[calc(100vh-4rem)] z-40 bg-[#0A0D12]/98 backdrop-blur-lg border-t border-[#202735] flex flex-col justify-between overflow-y-auto p-6 pb-24 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="space-y-4">
              {/* User Profile Info on mobile if logged in */}
              {user && (
                <div className="pb-4 border-b border-[#202735] mb-4">
                  <div className="text-sm font-bold text-white">
                    {user.user_metadata?.full_name || 'Trader'}
                  </div>
                  <div className="text-xs text-[#5D6B80]">{user.email}</div>
                </div>
              )}

              <div className="flex flex-col space-y-2">
                {mobileNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-xl text-base font-semibold transition-all duration-200",
                      location.pathname === item.path
                        ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                        : "text-[#8A95A5] hover:bg-[#11141A] hover:text-white border border-transparent"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    {item.label}
                  </Link>
                ))}
              </div>

              {/* Auth buttons for logged out users on mobile */}
              {!user && (
                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#202735] mt-4">
                  <Link
                    to="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="px-4 py-3 text-center text-sm font-bold text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all uppercase border border-[#202735]"
                  >
                    Login
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="px-4 py-3 text-center bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold tracking-wide rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)] transition-all uppercase"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>

            <div className="space-y-4 pt-6 mt-6 border-t border-[#202735]/40">
              {/* Install Button inside Hamburger Menu */}
              {deferredPrompt && (
                <button
                  onClick={() => {
                    installApp();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all uppercase text-sm tracking-wide border border-emerald-500/30 cursor-pointer"
                >
                  <span>📲 Install 4xLifeAI App</span>
                </button>
              )}

              {/* Log out on mobile if logged in */}
              {user && (
                <button
                  onClick={() => {
                    signOut();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold rounded-xl transition-all uppercase text-sm tracking-wide border border-red-500/10 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/support" element={<Support />} />
          
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected Routes */}
          <Route path="/test-loading" element={<LoadingScreen />} />
          <Route path="/today-signals" element={<ProtectedRoute><TodaySignals /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/trades" element={<ProtectedRoute><Trades /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><Referrals /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="/validation" element={<ProtectedRoute><ValidationAnalytics /></ProtectedRoute>} />
          <Route path="/ai-coach" element={<ProtectedRoute><AICoach /></ProtectedRoute>} />
          <Route path="/signals" element={<ProtectedRoute><Signals /></ProtectedRoute>} />
        </Routes>
      </main>

      <footer className="border-t border-[#202735] bg-[#070A0F] py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <Logo size={24} />
              <span className="font-bold text-sm tracking-tight text-white font-sans">4xLifeAI</span>
              <span className="text-xs text-[#5D6B80] border-l border-[#202735] pl-3">Institutional SMC Smart Engine</span>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 text-xs text-[#8A95A5]">
              <div>
                System Lead Architect: <span className="text-blue-400 font-semibold">Tofik Mohammed</span>
              </div>
              <div className="hidden sm:block text-[#202735]">|</div>
              <div>
                Status: <span className="text-emerald-400 font-semibold">● ACTIVE NODE</span>
              </div>
            </div>

            <div className="text-xs text-[#5D6B80]">
              &copy; 2026 4xLifeAI. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <GlobalLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}
