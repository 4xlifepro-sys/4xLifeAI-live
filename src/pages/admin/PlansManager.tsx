import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { RefreshCw, Save, Plus, X } from 'lucide-react';
import { cn } from '../../App';

interface Plan {
  id: string;
  name: string;
  price: string;
  billing_period: string | null;
  original_price: string | null;
  features: string[];
  is_popular: boolean;
  scan_limit: number | null;
}

export default function PlansManager() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('plans').select('*').order('created_at', { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else if (data) {
      setPlans(data);
    }
    setLoading(false);
  };

  const handleSave = async (plan: Plan) => {
    setSaving(true);
    const { error } = await supabase.from('plans').update({
      name: plan.name,
      price: plan.price,
      billing_period: plan.billing_period,
      original_price: plan.original_price,
      features: plan.features,
      is_popular: plan.is_popular,
      scan_limit: plan.scan_limit
    }).eq('id', plan.id);
    
    if (error) {
      alert("Error saving plan: " + error.message);
    } else {
      alert("Plan saved successfully!");
    }
    setSaving(false);
  };

  const handleFeatureChange = (planId: string, index: number, value: string) => {
    setPlans(plans.map(p => {
      if (p.id === planId) {
        const newFeatures = [...p.features];
        newFeatures[index] = value;
        return { ...p, features: newFeatures };
      }
      return p;
    }));
  };

  const handleAddFeature = (planId: string) => {
    setPlans(plans.map(p => {
      if (p.id === planId) {
        return { ...p, features: [...p.features, ""] };
      }
      return p;
    }));
  };

  const handleRemoveFeature = (planId: string, index: number) => {
    setPlans(plans.map(p => {
      if (p.id === planId) {
        const newFeatures = p.features.filter((_, i) => i !== index);
        return { ...p, features: newFeatures };
      }
      return p;
    }));
  };

  if (loading) return <div className="text-[#8A95A5] p-8 text-center"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>;
  if (errorMsg) return (
    <div className="bg-[#0D101A] border border-rose-500/20 rounded-3xl p-8 shadow-sm">
      <div className="text-rose-400 mb-2 font-bold flex items-center gap-2"><X className="w-5 h-5"/> Error loading plans</div>
      <p className="text-[#8A95A5] text-sm">{errorMsg}</p>
      <p className="text-[#8A95A5] text-sm mt-4">Please ensure the <code>plans</code> table has been created in your 4x SecureDB database.</p>
    </div>
  );

  return (
    <div className="bg-[#0D101A] border border-[#202735] rounded-3xl p-8 shadow-sm">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-white uppercase tracking-wider">Plans Management</h2>
          <p className="text-[#8A95A5] text-sm mt-1">Configure the public pricing and features</p>
        </div>
      </div>
      
      {plans.length === 0 && (
        <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-8 text-center">
          <p className="text-[#8A95A5] text-sm">No plans found. Please seed the database with initial plans.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        {plans.map((plan) => (
          <div key={plan.id} className="bg-[#11141A] border border-[#202735] rounded-2xl p-6 relative">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-1">Plan Name</label>
                <input 
                  type="text" 
                  value={plan.name}
                  onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, name: e.target.value } : p))}
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-1">Price</label>
                  <input 
                    type="text" 
                    value={plan.price}
                    onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, price: e.target.value } : p))}
                    className="w-full bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-1">Billing Period</label>
                  <input 
                    type="text" 
                    value={plan.billing_period || ''}
                    onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, billing_period: e.target.value } : p))}
                    className="w-full bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
                    placeholder="/per month"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-1">Original Price (Strikethrough)</label>
                  <input 
                    type="text" 
                    value={plan.original_price || ''}
                    onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, original_price: e.target.value } : p))}
                    className="w-full bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
                    placeholder="$39"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-1">Scan Limit</label>
                  <input 
                    type="number" 
                    value={plan.scan_limit === null ? '' : plan.scan_limit}
                    onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, scan_limit: e.target.value === '' ? null : parseInt(e.target.value) } : p))}
                    className="w-full bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
                    placeholder="Empty for unlimited"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <input 
                  type="checkbox" 
                  checked={plan.is_popular}
                  onChange={(e) => setPlans(plans.map(p => p.id === plan.id ? { ...p, is_popular: e.target.checked } : p))}
                  id={`popular-${plan.id}`}
                  className="w-4 h-4 rounded border-[#202735] bg-[#0D1017]"
                />
                <label htmlFor={`popular-${plan.id}`} className="text-sm text-white">Show "Most Popular" Badge</label>
              </div>

              <div className="pt-4 border-t border-[#202735]">
                <label className="block text-xs font-bold text-[#8A95A5] tracking-widest uppercase mb-3">Features</label>
                <div className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input 
                        type="text" 
                        value={feature}
                        onChange={(e) => handleFeatureChange(plan.id, i, e.target.value)}
                        className="flex-1 bg-[#0D1017] border border-[#202735] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                      />
                      <button 
                        onClick={() => handleRemoveFeature(plan.id, i)}
                        className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => handleAddFeature(plan.id)}
                  className="mt-3 flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 font-bold transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Feature
                </button>
              </div>

              <div className="pt-6">
                <button 
                  onClick={() => handleSave(plan)}
                  disabled={saving}
                  className="w-full flex justify-center items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-[0_0_15px_rgba(8,145,178,0.4)] disabled:opacity-50"
                >
                  <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
