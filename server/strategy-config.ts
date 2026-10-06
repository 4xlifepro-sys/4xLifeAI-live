import { supabase } from './supabase.js';
import {
  DEFAULT_STRATEGY_CONFIG,
  validateStrategyConfig,
  type StrategyConfig,
} from './strategy-engine.js';

export type StrategyPreset = {
  id: string;
  name: string;
  description: string;
  config: StrategyConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function readStrategyConfig(): Promise<{ config: StrategyConfig; storageReady: boolean; error?: string }> {
  if (!supabase) return { config: DEFAULT_STRATEGY_CONFIG, storageReady: false, error: 'Server Supabase connection is not configured.' };
  const { data, error } = await supabase.from('strategy_settings').select('config,active,strategy_version').eq('id', 1).maybeSingle();
  if (error) return { config: DEFAULT_STRATEGY_CONFIG, storageReady: false, error: error.message };
  if (!data) return { config: DEFAULT_STRATEGY_CONFIG, storageReady: false, error: 'Strategy settings have not been initialized. Apply strategy-platform-migration.sql to the application database.' };
  const checked = validateStrategyConfig({ ...DEFAULT_STRATEGY_CONFIG, ...(data.config || {}), active: data.active, version: data.strategy_version });
  if (checked.ok === false) return { config: DEFAULT_STRATEGY_CONFIG, storageReady: false, error: `Stored strategy configuration is invalid: ${checked.errors.join(' ')}` };
  return { config: checked.config, storageReady: true };
}

export async function writeStrategyConfig(configInput: unknown, updatedBy?: string, active?: boolean, presetId?: string | null): Promise<{ config?: StrategyConfig; error?: string }> {
  if (!supabase) return { error: 'Server Supabase connection is not configured.' };
  const { config: current, storageReady, error: readError } = await readStrategyConfig();
  if (!storageReady) return { error: readError || 'Strategy settings database is not ready.' };
  const checked = validateStrategyConfig(configInput);
  if (checked.ok === false) return { error: checked.errors.join(' ') };
  const config: StrategyConfig = {
    ...checked.config,
    active: active ?? current.active,
    backtestApproved: false,
    version: current.version + 1,
    maximumConfidence: 80,
  };
  const { error } = await supabase.from('strategy_settings').upsert({
    id: 1,
    config,
    active: config.active,
    strategy_version: config.version,
    updated_by: updatedBy || null,
    active_preset_id: presetId === undefined ? null : presetId,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  return { config };
}

export async function listStrategyPresets(): Promise<{ presets: StrategyPreset[]; error?: string }> {
  if (!supabase) return { presets: [], error: 'Server Supabase connection is not configured.' };
  const { data, error } = await supabase.from('strategy_presets').select('*').order('name', { ascending: true });
  if (error) return { presets: [], error: error.message };
  return { presets: (data || []) as StrategyPreset[] };
}

export async function createStrategyPreset(nameInput: unknown, descriptionInput: unknown, configInput: unknown, createdBy?: string): Promise<{ preset?: StrategyPreset; error?: string }> {
  if (!supabase) return { error: 'Server Supabase connection is not configured.' };
  const name = String(nameInput || '').trim().slice(0, 64);
  const description = String(descriptionInput || '').trim().slice(0, 240);
  if (!name) return { error: 'Preset name is required.' };
  const checked = validateStrategyConfig({ ...((configInput && typeof configInput === 'object') ? configInput : {}), active: false });
  if (checked.ok === false) return { error: checked.errors.join(' ') };
  const { data, error } = await supabase.from('strategy_presets').insert({
    name,
    description,
    config: { ...checked.config, active: false },
    is_active: false,
    created_by: createdBy || null,
  }).select('*').single();
  if (error) return { error: error.message };
  return { preset: data as StrategyPreset };
}

export async function activateStrategyPreset(id: string, updatedBy?: string): Promise<{ config?: StrategyConfig; error?: string }> {
  if (!supabase) return { error: 'Server Supabase connection is not configured.' };
  const { data: preset, error: presetError } = await supabase.from('strategy_presets').select('*').eq('id', id).maybeSingle();
  if (presetError) return { error: presetError.message };
  if (!preset) return { error: 'Strategy preset not found.' };
  const saved = await writeStrategyConfig(preset.config, updatedBy, true, preset.id);
  if (saved.error || !saved.config) return saved;
  const { error } = await supabase.from('strategy_presets').update({ is_active: false, updated_at: new Date().toISOString() }).neq('id', id);
  if (error) return { error: `Strategy activated but preset labels could not be synchronized: ${error.message}` };
  const { error: activeError } = await supabase.from('strategy_presets').update({ is_active: true, updated_at: new Date().toISOString() }).eq('id', id);
  if (activeError) return { error: `Strategy activated but preset label could not be synchronized: ${activeError.message}` };
  return saved;
}

export async function updatePresetActivation(id: string, isActive: boolean): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Server Supabase connection is not configured.' };
  const { error } = await supabase.from('strategy_presets').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? { error: error.message } : {};
}
