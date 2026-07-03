import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Mail, Lock, User, Loader2, Target, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function Signup() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('System configuration error: Supabase client is not initialized.');
      return;
    }
    setError(null);
    
    if (password.length < 8) {
       setError('Password must be at least 8 characters long.');
       return;
    }
    
    if (password !== confirmPassword) {
       setError('Passwords do not match.');
       return;
    }

    if (!acceptTerms) {
       setError('You must accept the Terms and Privacy Policy.');
       return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: window.location.origin + '/login',
        }
      });

      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      let msg = err.message || 'Failed to sign up';
      if (msg === '{}' || msg.includes('AuthRetryableFetchError')) {
         msg = 'Database error during signup (Internal Server Error 500). Please verify your Supabase on_auth_user_created database trigger handles column names correctly (e.g. check "admin_id" vs "user_id" in admin_audit_logs).';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (!supabase) {
        setError('System configuration error: Supabase client is not initialized.');
        return;
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/dashboard',
        }
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Failed to sign up with Google');
    }
  };

  if (success) {
     return (
       <div className="flex-1 flex flex-col items-center justify-center p-6 w-full relative z-10">
         <div className="w-full max-w-md bg-[#11141A] border border-[#202735] p-8 rounded-2xl shadow-2xl backdrop-blur-sm text-center">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full mx-auto flex items-center justify-center mb-6">
               <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
            <p className="text-[#8A95A5] mb-8">
               We've sent a verification link to <span className="text-white font-medium">{email}</span>. Please verify your email to continue.
            </p>
            <Link 
               to="/login"
               className="w-full bg-[#0A0D12] hover:bg-white/5 border border-[#202735] text-white font-bold py-3 px-4 rounded-xl transition-all block"
            >
               Return to Login
            </Link>
         </div>
       </div>
     );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 w-full relative z-10">
      <div className="w-full max-w-md">
        
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Create Account</h1>
          <p className="text-[#8A95A5]">Join 4xLifeAI Engine</p>
        </div>

        <div className="bg-[#11141A] border border-[#202735] p-8 rounded-2xl shadow-2xl backdrop-blur-sm">
          {error && (
             <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg flex items-start gap-3">
               <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
               <p className="text-sm font-medium">{error}</p>
             </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#8A95A5] block">Full Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-[#5D6B80]" />
                </div>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#0A0D12] border border-[#202735] rounded-xl text-white placeholder-[#5D6B80] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                  placeholder="John Doe"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#8A95A5] block">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-[#5D6B80]" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#0A0D12] border border-[#202735] rounded-xl text-white placeholder-[#5D6B80] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                  placeholder="you@email.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#8A95A5] block">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-[#5D6B80]" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#0A0D12] border border-[#202735] rounded-xl text-white placeholder-[#5D6B80] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                  placeholder="Min. 8 characters"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#8A95A5] block">Confirm Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-[#5D6B80]" />
                </div>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#0A0D12] border border-[#202735] rounded-xl text-white placeholder-[#5D6B80] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5">
                   <input
                     type="checkbox"
                     checked={acceptTerms}
                     onChange={(e) => setAcceptTerms(e.target.checked)}
                     className="w-5 h-5 rounded bg-[#0A0D12] border border-[#202735] appearance-none checked:bg-blue-600 checked:border-blue-600 transition-colors"
                   />
                   {acceptTerms && <Target className="w-3.5 h-3.5 text-white absolute pointer-events-none" />}
                </div>
                <span className="text-sm text-[#8A95A5] leading-snug">
                   I accept the <a href="#" className="text-white hover:text-blue-400">Terms of Service</a> and <a href="#" className="text-white hover:text-blue-400">Privacy Policy</a>
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 px-4 rounded-xl shadow-[0_0_20px_rgba(20,184,166,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
            >
              {loading ? (
                 <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                 "Create Account"
              )}
            </button>
          </form>

          <div className="mt-8 relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#202735]"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-[#11141A] text-[#5D6B80] font-medium uppercase tracking-widest text-xs">Or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleSignup}
            type="button"
            className="mt-6 w-full bg-[#0A0D12] hover:bg-white/5 border border-[#202735] hover:border-[#303B50] text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-3"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" width="24" height="24">
               <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
               <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
               <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
               <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Google
          </button>
        </div>

        <p className="mt-8 text-center text-sm text-[#8A95A5]">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-white hover:text-blue-400 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
