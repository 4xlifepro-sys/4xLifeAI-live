import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Mail, Loader2, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('System temporarily unavailable. Please try again later.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      });

      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 w-full relative z-10">
        <div className="w-full max-w-md bg-[#11141A] border border-[#202735] p-8 rounded-2xl shadow-2xl backdrop-blur-sm text-center">
           <div className="w-16 h-16 bg-emerald-500/10 rounded-full mx-auto flex items-center justify-center mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
           </div>
           <h2 className="text-2xl font-bold text-white mb-2">Password reset email sent.</h2>
           <p className="text-[#8A95A5] mb-8">
              We've sent password reset instructions to <span className="text-white font-medium">{email}</span>.
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
        
        <div className="mb-8 pl-2">
          <Link to="/login" className="inline-flex items-center gap-2 text-[#8A95A5] hover:text-white transition-colors mb-6 font-medium text-sm">
             <ArrowLeft className="w-4 h-4" />
             Back to login
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Forgot Password</h1>
          <p className="text-[#8A95A5]">Enter your email and we'll send you a link to reset your password.</p>
        </div>

        <div className="bg-[#11141A] border border-[#202735] p-8 rounded-2xl shadow-2xl backdrop-blur-sm">
          {error && (
             <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg flex items-start gap-3">
               <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
               <p className="text-sm font-medium">{error}</p>
             </div>
          )}

          <form onSubmit={handleReset} className="space-y-6">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
            >
              {loading ? (
                 <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                 "Send Reset Link"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
