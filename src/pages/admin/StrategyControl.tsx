import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, Database, Play, Save, Shield, ToggleLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Timeframe = { timeframe: string; role: 'HIGHER' | 'MIDDLE' | 'LOWER'; enabled: boolean };
type Config = {
  name: string;
  version: number;
  active: boolean;
  backtestApproved: boolean;
  timeframes: Timeframe[];
  conditions: Record<string, 'REQUIRED' | 'OPTIONAL' | 'DISABLED'>;
  poiModes: Record<string, 'REQUIRED' | 'OPTIONAL' | 'DISABLED'>;
  sessionWindowsUtc: { londonStart: number; londonEnd: number; newYorkStart: number; newYorkEnd: number };
  poiWeights: Record<string, number>;
  conditionWeights: Record<string, number>;
  minimumScore: number;
  countertrendEnabled: boolean;
  countertrendMinimumScore: number;
  riskPercent: number;
  maximumRiskPercent: number;
  minimumRewardRisk: number;
  maximumConfidence: 80;
  poiAtrTolerance: number;
  swingLookback: number;
  slBufferAtr: number;
  allowedSymbols: string[];
};
type Preset = { id: string; name: string; description: string; config: Config; is_active: boolean };
type Analysis = {
  pair: string;
  state: string;
  lowerTimeframe: string;
  dataStatus: string;
  htfBias: string;
  marketStructure: string;
  mainPoi: null | { type: string; price: number; timeframe: string; direction: string; status: string; score: number };
  middleSetup: string;
  mss: string;
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  riskReward: number | null;
  internalScore: number | null;
  confidence: number | null;
  reason: string;
  warnings: string[];
  conditions: Record<string, { mode: string; confirmed: boolean | null; reason: string }>;
};

const TIMEFRAMES = ['1M', '3M', '5M', '15M', '30M', '1H', '2H', '4H', '1D', '1W'];
const POIS = ['SBR', 'RBS', 'CLASSIC A', 'CLASSIC V', 'OCL', 'MAJOR SUPPORT', 'MAJOR RESISTANCE'];
const CONDITION_LABELS: Record<string, string> = {
  POI: 'Single Main POI', HTF_BIAS: 'Higher timeframe bias', MIDDLE_SETUP: 'Middle timeframe setup', MSS: 'Lower-timeframe MSS',
  LIQUIDITY_SWEEP: 'Liquidity sweep', FVG: 'Fair Value Gap', FVG_RETEST: 'FVG retest', DISPLACEMENT: 'Displacement',
  PREMIUM_DISCOUNT: 'Premium / Discount', EMA_200: 'EMA 200', OCL: 'OCL', QML: 'QML', ORDER_BLOCK: 'Order Block',
  LONDON_SESSION: 'London session', NEW_YORK_SESSION: 'New York session', RISK: 'Risk validation',
};
const TEMPLATES = ['CLASSIC A', 'CLASSIC V', 'ICT CONSERVATIVE', 'ICT AGGRESSIVE', 'SMC', 'MSNR', 'FULL ICT + SMC + MSNR', 'CUSTOM'];

function statusClass(status: string) {
  if (status === 'BUY' || status === 'CONFIRMED' || status === 'VALID') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
  if (status === 'SELL') return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
  if (status === 'WAITING' || status === 'NOT CONFIRMED') return 'text-amber-200 border-amber-500/30 bg-amber-500/10';
  return 'text-slate-300 border-slate-500/30 bg-slate-500/10';
}

export default function StrategyControl() {
  const [config, setConfig] = useState<Config | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [template, setTemplate] = useState('FULL ICT + SMC + MSNR');
  const [presetName, setPresetName] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const timeframeChoices = useMemo(() => config?.timeframes || [], [config]);

  const request = async (url: string, options: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request('/api/admin/strategy/config');
      setConfig(data.config);
      setStorageError(data.storageReady ? '' : data.storageError || 'Strategy configuration is not persisted yet.');
      setPresets(data.presets || []);
    } catch (cause: any) {
      setError(cause.message || 'Unable to load strategy settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateConfig = (patch: Partial<Config>) => setConfig(current => current ? { ...current, ...patch } : current);

  const changeTimeframe = (index: number, patch: Partial<Timeframe>) => {
    if (!config) return;
    updateConfig({ timeframes: config.timeframes.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  };

  const save = async () => {
    if (!config) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('/api/admin/strategy/config', { method: 'PUT', body: JSON.stringify({ config }) });
      setConfig(result.config);
      setNotice('Strategy configuration saved. It remains inactive until explicitly activated.');
      await load();
    } catch (cause: any) {
      setError(cause.message || 'Unable to save strategy.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request(`/api/admin/strategy/${active ? 'activate' : 'deactivate'}`, { method: 'POST', body: JSON.stringify({ config }) });
      setConfig(result.config);
      setNotice(active ? 'Automatic market analysis activated. Signal publication remains locked until historical out-of-sample and demo validation approve this strategy version; no broker orders are placed.' : 'Strategy deactivated. Automatic signal publication is stopped.');
      await load();
    } catch (cause: any) {
      setError(cause.message || 'Unable to change strategy status.');
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = () => {
    if (!config) return;
    const required = ['POI', 'HTF_BIAS', 'MIDDLE_SETUP', 'MSS', 'RISK'];
    const conditions = Object.fromEntries(Object.entries(config.conditions).map(([key]) => [key, required.includes(key) ? 'REQUIRED' : 'OPTIONAL'])) as Config['conditions'];
    if (template === 'CLASSIC A') {
      updateConfig({ name: template, conditions, poiWeights: { ...config.poiWeights, 'CLASSIC A': 100, 'CLASSIC V': 35, SBR: 45, RBS: 45, OCL: 30 } });
    } else if (template === 'CLASSIC V') {
      updateConfig({ name: template, conditions, poiWeights: { ...config.poiWeights, 'CLASSIC A': 35, 'CLASSIC V': 100, SBR: 45, RBS: 45, OCL: 30 } });
    } else if (template === 'ICT CONSERVATIVE') {
      updateConfig({ name: template, conditions: { ...conditions, LIQUIDITY_SWEEP: 'REQUIRED', FVG: 'REQUIRED', DISPLACEMENT: 'REQUIRED' }, minimumScore: 75 });
    } else if (template === 'ICT AGGRESSIVE') {
      updateConfig({ name: template, conditions: { ...conditions, LIQUIDITY_SWEEP: 'OPTIONAL', FVG: 'OPTIONAL' }, minimumScore: 60 });
    } else if (template === 'SMC') {
      updateConfig({ name: template, conditions: { ...conditions, DISPLACEMENT: 'REQUIRED' }, minimumScore: 70 });
    } else if (template === 'MSNR') {
      updateConfig({ name: template, conditions: { ...conditions, OCL: 'OPTIONAL' }, minimumScore: 70 });
    } else {
      updateConfig({ name: template });
    }
    setNotice(`${template} template applied locally. Save and test it before activation.`);
  };

  const savePreset = async () => {
    if (!config || !presetName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/admin/strategy/presets', {
        method: 'POST', body: JSON.stringify({ name: presetName, description: `Saved ${config.name} configuration`, config }),
      });
      setPresets(current => [...current, result.preset]);
      setPresetName('');
      setNotice('Strategy preset saved.');
    } catch (cause: any) {
      setError(cause.message || 'Unable to save preset.');
    } finally {
      setBusy(false);
    }
  };

  const activatePreset = async () => {
    if (!selectedPreset) return;
    setBusy(true);
    setError('');
    try {
      const result = await request(`/api/admin/strategy/presets/${selectedPreset}/activate`, { method: 'POST', body: '{}' });
      setConfig(result.config);
      setNotice('Preset activated. Check the test panel and engine status before relying on signals.');
      await load();
    } catch (cause: any) {
      setError(cause.message || 'Unable to activate preset.');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setError('');
    setAnalysis(null);
    try {
      const result = await request('/api/admin/strategy/test', { method: 'POST', body: JSON.stringify({ symbol, config }) });
      setAnalysis(result.analysis);
      if (result.persistenceWarning) setNotice(result.persistenceWarning);
    } catch (cause: any) {
      setError(cause.message || 'Strategy test could not complete.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !config) return <div className="p-8 text-slate-300">Loading strategy controller…</div>;

  return (
    <div className="space-y-6 text-slate-200">
      <section className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Shield size={18} /><span className="text-xs font-bold uppercase tracking-[0.2em]">4xLifeAI Strategy Control</span></div>
            <h1 className="mt-2 text-2xl font-semibold text-white">{config.name}</h1>
            <p className="mt-1 text-sm text-slate-400">Version {config.version} · Customer confidence is calculated automatically and capped at 80/100.</p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${config.active ? statusClass('VALID') : statusClass('INACTIVE')}`}>
            <Activity size={14} /> {config.active ? 'STRATEGY ACTIVE' : 'INACTIVE — SAFE MODE'}
          </span>
        </div>
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
          This controller generates analysis-backed signals only. It does not place trades with a broker. Backtest and demo-test a strategy before enabling customer publication; no win rate is guaranteed.
        </div>
        {storageError && <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><Database size={18} className="mt-0.5 shrink-0" /><div><strong>Persistent settings not ready.</strong> {storageError} Save/activate is disabled until the application database has the strategy migration.</div></div>}
        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><Check size={17} />{notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"><AlertTriangle size={17} />{error}</div>}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5">
          <h2 className="text-lg font-semibold text-white">Timeframe roles</h2>
          <p className="mb-4 mt-1 text-xs text-slate-400">Default: Daily + 4H → 1H + 15M → 5M. Reassign roles as needed.</p>
          <div className="space-y-2">
            {TIMEFRAMES.map((timeframe) => {
              const index = timeframeChoices.findIndex(item => item.timeframe === timeframe);
              const item = timeframeChoices[index];
              return <div key={timeframe} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-slate-800 p-3">
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={item?.enabled || false} onChange={event => index >= 0 && changeTimeframe(index, { enabled: event.target.checked })} />{timeframe}</label>
                <select aria-label={`${timeframe} role`} disabled={!item?.enabled} value={item?.role || 'HIGHER'} onChange={event => index >= 0 && changeTimeframe(index, { role: event.target.value as Timeframe['role'] })} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs">
                  <option>HIGHER</option><option>MIDDLE</option><option>LOWER</option>
                </select>
                <span className="text-[10px] text-slate-500">{item?.enabled ? 'ENABLED' : 'OFF'}</span>
              </div>;
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5">
          <h2 className="text-lg font-semibold text-white">Required conditions</h2>
          <p className="mb-4 mt-1 text-xs text-slate-400">A high score cannot override a missing REQUIRED condition.</p>
          <div className="space-y-2">
            {Object.entries(CONDITION_LABELS).map(([key, label]) => <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-slate-800 p-3">
              <span className="text-sm">{label}{key === 'MSS' && <span className="ml-2 text-[10px] text-amber-300">DEFAULT REQUIRED</span>}</span>
              <select aria-label={`${label} mode`} value={config.conditions[key] || 'DISABLED'} onChange={event => updateConfig({ conditions: { ...config.conditions, [key]: event.target.value as Config['conditions'][string] } })} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs">
                <option>REQUIRED</option><option>OPTIONAL</option><option>DISABLED</option>
              </select>
            </div>)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5">
          <h2 className="text-lg font-semibold text-white">Main POI ranking</h2>
          <p className="mb-4 mt-1 text-xs text-slate-400">The engine selects one strongest POI; it does not combine POIs.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {POIS.map(poi => <label key={poi} className="rounded-lg border border-slate-800 p-3 text-xs text-slate-300">{poi}
              <select value={config.poiModes[poi] || 'DISABLED'} onChange={event => updateConfig({ poiModes: { ...config.poiModes, [poi]: event.target.value as Config['poiModes'][string] } })} className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option>REQUIRED</option><option>OPTIONAL</option><option>DISABLED</option></select>
              <input type="number" min="0" max="100" value={config.poiWeights[poi] ?? 0} onChange={event => updateConfig({ poiWeights: { ...config.poiWeights, [poi]: Number(event.target.value) } })} className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
            </label>)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5">
          <h2 className="text-lg font-semibold text-white">Score, risk and safeguards</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumberField label="Minimum internal score" value={config.minimumScore} onChange={value => updateConfig({ minimumScore: value })} min={1} max={100} />
            <NumberField label="Default risk %" value={config.riskPercent} onChange={value => updateConfig({ riskPercent: value })} min={0.1} max={2} step={0.1} />
            <NumberField label="Maximum risk %" value={config.maximumRiskPercent} onChange={value => updateConfig({ maximumRiskPercent: value })} min={0.1} max={2} step={0.1} />
            <NumberField label="Minimum RR (structure target only)" value={config.minimumRewardRisk} onChange={value => updateConfig({ minimumRewardRisk: value })} min={0.1} max={10} step={0.1} />
            <NumberField label="POI distance (ATR)" value={config.poiAtrTolerance} onChange={value => updateConfig({ poiAtrTolerance: value })} min={0.1} max={5} step={0.1} />
            <NumberField label="Structural SL buffer (ATR)" value={config.slBufferAtr} onChange={value => updateConfig({ slBufferAtr: value })} min={0} max={2} step={0.05} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {Object.entries(config.conditionWeights).map(([key, value]) => <NumberField key={key} label={`${CONDITION_LABELS[key] || key} weight`} value={value} onChange={weight => updateConfig({ conditionWeights: { ...config.conditionWeights, [key]: weight } })} min={0} max={100} />)}
          </div>
          <h3 className="mt-5 text-sm font-medium text-slate-200">ICT session windows (UTC)</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberField label="London start hour" value={config.sessionWindowsUtc.londonStart} onChange={value => updateConfig({ sessionWindowsUtc: { ...config.sessionWindowsUtc, londonStart: value } })} min={0} max={23} />
            <NumberField label="London end hour" value={config.sessionWindowsUtc.londonEnd} onChange={value => updateConfig({ sessionWindowsUtc: { ...config.sessionWindowsUtc, londonEnd: value } })} min={1} max={24} />
            <NumberField label="New York start hour" value={config.sessionWindowsUtc.newYorkStart} onChange={value => updateConfig({ sessionWindowsUtc: { ...config.sessionWindowsUtc, newYorkStart: value } })} min={0} max={23} />
            <NumberField label="New York end hour" value={config.sessionWindowsUtc.newYorkEnd} onChange={value => updateConfig({ sessionWindowsUtc: { ...config.sessionWindowsUtc, newYorkEnd: value } })} min={1} max={24} />
          </div>
          <label className="mt-4 flex items-center gap-3 rounded-lg border border-slate-800 p-3 text-sm"><input type="checkbox" checked={config.countertrendEnabled} onChange={event => updateConfig({ countertrendEnabled: event.target.checked })} />Allow countertrend setups (off by default)</label>
          <div className="mt-4"><NumberField label="Countertrend minimum score" value={config.countertrendMinimumScore} onChange={value => updateConfig({ countertrendMinimumScore: value })} min={1} max={100} /></div>
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">Customer confidence cap is fixed at <strong>80/100</strong>; the scoring engine controls the actual value.</div>
        </div>

        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5 xl:col-span-2">
          <h2 className="text-lg font-semibold text-white">Presets and activation</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Apply template locally</label>
              <select value={template} onChange={event => setTemplate(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm">{TEMPLATES.map(value => <option key={value}>{value}</option>)}</select>
              <button onClick={applyTemplate} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Apply template</button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Saved preset</label>
              <select value={selectedPreset} onChange={event => setSelectedPreset(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="">Choose a saved preset</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}{preset.is_active ? ' · ACTIVE' : ''}</option>)}</select>
              <button disabled={!selectedPreset || busy || Boolean(storageError)} onClick={activatePreset} className="w-full rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40">Activate preset</button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Save current config as preset</label>
              <input value={presetName} onChange={event => setPresetName(event.target.value)} maxLength={64} placeholder="Preset name" className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
              <button disabled={!presetName.trim() || busy || Boolean(storageError)} onClick={savePreset} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-40">Save preset</button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={busy || Boolean(storageError)} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"><Save size={16} />Save strategy</button>
            {config.active
              ? <button disabled={busy || Boolean(storageError)} onClick={() => void setActive(false)} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-4 py-2.5 text-sm text-rose-200 disabled:opacity-40"><ToggleLeft size={16} />Deactivate</button>
              : <button disabled={busy || Boolean(storageError)} onClick={() => void setActive(true)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-4 py-2.5 text-sm text-emerald-200 disabled:opacity-40"><Play size={16} />Activate strategy</button>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/70 bg-[#0b1018] p-5 xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-lg font-semibold text-white">Live market strategy test</h2><p className="mt-1 text-xs text-slate-400">Uses the latest available cTrader candles for enabled timeframes. This is not a historical backtest.</p></div>
            <div className="flex gap-2"><select value={symbol} onChange={event => setSymbol(event.target.value)} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm">{config.allowedSymbols.map(pair => <option key={pair}>{pair}</option>)}</select><button disabled={busy} onClick={runTest} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 disabled:opacity-40"><Play size={15} />Test now</button></div>
          </div>
          {analysis && <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-lg font-semibold text-white">{analysis.pair}</div><span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClass(analysis.state)}`}>{analysis.state}</span><span className="text-xs text-slate-400">Data: {analysis.dataStatus} · HTF: {analysis.htfBias} · Score: {analysis.internalScore ?? 'UNKNOWN'} · Confidence: {analysis.confidence ?? 'UNKNOWN'}/100</span></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <DataTile label="Main POI" value={analysis.mainPoi ? `${analysis.mainPoi.type} · ${analysis.mainPoi.price} · ${analysis.mainPoi.timeframe}` : 'UNKNOWN'} />
              <DataTile label="POI state" value={analysis.mainPoi ? `${analysis.mainPoi.status} · ${analysis.mainPoi.direction}` : 'DATA NOT AVAILABLE'} />
              <DataTile label="Middle setup" value={analysis.middleSetup} />
              <DataTile label={`${analysis.lowerTimeframe} MSS`} value={analysis.mss} />
              <DataTile label="Entry" value={analysis.entry ?? 'UNKNOWN'} />
              <DataTile label="Structural SL" value={analysis.stopLoss ?? 'UNKNOWN'} />
              <DataTile label="Structural targets" value={analysis.targets.length ? analysis.targets.join(' · ') : 'DATA NOT AVAILABLE'} />
              <DataTile label="Reward / Risk" value={analysis.riskReward ? `1:${analysis.riskReward.toFixed(2)}` : 'UNKNOWN'} />
            </div>
            <p className="mt-4 text-sm text-slate-200">{analysis.reason}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(analysis.conditions).map(([key, condition]) => <div key={key} className="flex items-start justify-between gap-2 rounded border border-slate-800 p-2 text-xs"><span>{CONDITION_LABELS[key] || key}<span className="ml-2 text-slate-500">{condition.mode}</span></span><span className={condition.confirmed ? 'text-emerald-300' : 'text-amber-200'}>{condition.confirmed === null ? 'UNKNOWN' : condition.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}</span></div>)}</div>
            {analysis.warnings.map(warning => <p key={warning} className="mt-3 text-xs text-amber-200">{warning}</p>)}
          </div>}
        </div>
      </section>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return <label className="block text-xs text-slate-400">{label}<input type="number" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /></label>;
}

function DataTile({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded border border-slate-800 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 break-words text-sm text-white">{String(value)}</div></div>;
}
