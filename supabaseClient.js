const { createClient } = require('@supabase/supabase-js');

let supabase = null;
let currentConfig = {
  url: process.env.SUPABASE_URL || 'https://osifexxyqaadkwqrmgds.supabase.co',
  key: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
};

function initSupabase(url = currentConfig.url, key = currentConfig.key) {
  currentConfig.url = url;
  currentConfig.key = key;

  if (url && key) {
    try {
      supabase = createClient(url, key, {
        auth: { persistSession: false }
      });
      console.log(`[Supabase] Client initialized for ${url}`);
      return true;
    } catch (err) {
      console.error('[Supabase] Failed to initialize client:', err.message);
      supabase = null;
      return false;
    }
  } else {
    supabase = null;
    return false;
  }
}

// Auto-initialize on import
initSupabase();

function isConnected() {
  return supabase !== null && Boolean(currentConfig.key);
}

function getConfig() {
  return {
    url: currentConfig.url,
    hasKey: Boolean(currentConfig.key),
    keyPreview: currentConfig.key ? (currentConfig.key.slice(0, 8) + '...' + currentConfig.key.slice(-4)) : ''
  };
}

// Map Prompt object to Supabase database row
function toDbPrompt(p) {
  return {
    id: p.id,
    title: p.title || '',
    content: p.content || '',
    notes: p.notes || '',
    why_it_works: p.whyItWorks || p.why_it_works || '',
    how_not_to_prompt: p.howNotToPrompt || p.how_not_to_prompt || '',
    status: p.status || 'draft',
    order: p.order !== undefined ? Number(p.order) : 0,
    created_at: p.createdAt || p.created_at || new Date().toISOString(),
    deployed_at: p.deployedAt || p.deployed_at || null
  };
}

// Map Supabase database row to Prompt object
function fromDbPrompt(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    notes: row.notes || '',
    whyItWorks: row.why_it_works ?? row.whyItWorks ?? '',
    howNotToPrompt: row.how_not_to_prompt ?? row.howNotToPrompt ?? '',
    status: row.status || 'draft',
    order: row.order !== undefined ? Number(row.order) : 0,
    createdAt: row.created_at || row.createdAt,
    deployedAt: row.deployed_at || row.deployedAt
  };
}

/**
 * Fetch all prompts and workshop settings from Supabase
 */
async function loadAllFromSupabase() {
  if (!isConnected()) {
    return { success: false, reason: 'Supabase client not initialized or missing API key' };
  }

  try {
    // 1. Fetch prompts
    const { data: promptsData, error: promptsError } = await supabase
      .from('prompts')
      .select('*')
      .order('order', { ascending: true });

    if (promptsError) {
      console.error('[Supabase] Error loading prompts:', promptsError.message);
      return { success: false, error: promptsError.message };
    }

    // 2. Fetch workshop settings
    const { data: settingsData, error: settingsError } = await supabase
      .from('workshop_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.warn('[Supabase] Error loading workshop_settings (may not exist yet):', settingsError.message);
    }

    const prompts = (promptsData || []).map(fromDbPrompt);
    const settings = settingsData ? {
      workshopTitle: settingsData.workshop_title ?? settingsData.workshopTitle,
      activePromptId: settingsData.active_prompt_id ?? settingsData.activePromptId,
      broadcast: settingsData.broadcast
    } : null;

    return {
      success: true,
      prompts,
      settings
    };
  } catch (err) {
    console.error('[Supabase] loadAllFromSupabase exception:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Save / Upsert a single prompt
 */
async function savePrompt(prompt) {
  if (!isConnected()) return false;
  try {
    const row = toDbPrompt(prompt);
    const { error } = await supabase
      .from('prompts')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.error(`[Supabase] Error saving prompt ${prompt.id}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Supabase] Exception saving prompt ${prompt.id}:`, err.message);
    return false;
  }
}

/**
 * Delete a prompt
 */
async function deletePrompt(id) {
  if (!isConnected()) return false;
  try {
    const { error } = await supabase
      .from('prompts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`[Supabase] Error deleting prompt ${id}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Supabase] Exception deleting prompt ${id}:`, err.message);
    return false;
  }
}

/**
 * Save workshop settings
 */
async function saveSettings(workshopTitle, activePromptId, broadcast) {
  if (!isConnected()) return false;
  try {
    const row = {
      id: 'default',
      workshop_title: workshopTitle,
      active_prompt_id: activePromptId,
      broadcast: broadcast,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('workshop_settings')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.error('[Supabase] Error saving workshop settings:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Exception saving workshop settings:', err.message);
    return false;
  }
}

/**
 * Bulk upload prompts to Supabase (e.g. initial migration)
 */
async function syncAllToSupabase(store) {
  if (!isConnected()) return { success: false, reason: 'Not connected' };
  try {
    if (Array.isArray(store.prompts) && store.prompts.length > 0) {
      const rows = store.prompts.map(toDbPrompt);
      const { error } = await supabase
        .from('prompts')
        .upsert(rows, { onConflict: 'id' });

      if (error) {
        console.error('[Supabase] Error migrating prompts:', error.message);
        return { success: false, error: error.message };
      }
    }

    await saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);
    console.log(`[Supabase] Successfully synced ${store.prompts.length} prompts to Supabase.`);
    return { success: true, count: store.prompts.length };
  } catch (err) {
    console.error('[Supabase] Exception during syncAllToSupabase:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  initSupabase,
  isConnected,
  getConfig,
  loadAllFromSupabase,
  savePrompt,
  deletePrompt,
  saveSettings,
  syncAllToSupabase
};

