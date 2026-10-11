import { KeyRound, Shield, ArrowRight, CheckCircle2 } from 'lucide-react';

const LICENSE_PORTAL_URL = 'https://4xlife-license-production.up.railway.app/portal';
const LICENSE_ADMIN_URL = 'https://4xlife-license-production.up.railway.app/admin';

export default function License() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 mb-4">
          <KeyRound className="w-8 h-8 text-cyan-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">4XLIFE EA License Center</h1>
        <p className="text-[#8A95A5] mt-3 max-w-2xl mx-auto">
          Activate your EA license, connect it to your MT5 account, and download the compiled EA file.
          Everything is protected and verified over HTTPS.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Customer portal */}
        <a
          href={LICENSE_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative rounded-2xl border border-[#202735] bg-[#0B0F16] hover:border-cyan-500/50 transition-all p-8 shadow-lg hover:shadow-cyan-500/10"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 mb-5">
            <KeyRound className="w-6 h-6 text-cyan-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Customer Portal</h2>
          <p className="text-sm text-[#8A95A5] mb-6">
            For customers: register or log in, activate your license for your MT5 account,
            and download the EA file (.ex5).
          </p>
          <ul className="space-y-2 text-sm text-slate-300 mb-8">
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Activate license on your MT5 account</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Download the EA file securely</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> See your expiry date and status</li>
          </ul>
          <span className="inline-flex items-center gap-2 text-cyan-400 font-bold text-sm group-hover:gap-3 transition-all">
            Open Customer Portal <ArrowRight className="w-4 h-4" />
          </span>
        </a>

        {/* Admin */}
        <a
          href={LICENSE_ADMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative rounded-2xl border border-[#202735] bg-[#0B0F16] hover:border-amber-500/50 transition-all p-8 shadow-lg hover:shadow-amber-500/10"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 mb-5">
            <Shield className="w-6 h-6 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Admin — License Manager</h2>
          <p className="text-sm text-[#8A95A5] mb-6">
            Administrator access only: create licenses, confirm payments, renew,
            suspend or revoke. Password protected.
          </p>
          <ul className="space-y-2 text-sm text-slate-300 mb-8">
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Create and manage customer licenses</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Update the customer EA download file</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Secure — only a password hash is stored</li>
          </ul>
          <span className="inline-flex items-center gap-2 text-amber-400 font-bold text-sm group-hover:gap-3 transition-all">
            Open Admin Dashboard <ArrowRight className="w-4 h-4" />
          </span>
        </a>
      </div>

      <p className="text-center text-xs text-[#5D6B80] mt-10">
        Warning: trading involves risk. A license gives access to the software — it does not guarantee profit.
      </p>
    </div>
  );
}
