require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const supabaseClient = require('./supabaseClient');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'workshop2026';
const DATA_FILE = path.join(__dirname, 'data', 'prompts.json');
const ENV_FILE = path.join(__dirname, '.env');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fallback in-memory store (used only if Supabase is offline / unreachable)
let fallbackStore = {
  workshopTitle: process.env.WORKSHOP_NAME || 'Google Antigravity workshop by T M Saravanan',
  activePromptId: null,
  broadcast: null,
  prompts: []
};

// Load offline fallback from local file
function loadFallback() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      fallbackStore = JSON.parse(raw);
    }
  } catch (err) {
    // Ignore in serverless
  }
}
loadFallback();

// Save offline fallback (disabled on Vercel)
function saveFallback() {
  if (process.env.VERCEL) return;
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallbackStore, null, 2), 'utf8');
  } catch (err) {
    // Ignore
  }
}

// Connected SSE clients
const sseClients = new Set();

function broadcastEvent(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

/**
 * Fetch workshop state strictly from Supabase (or fallback if offline)
 */
async function getLiveWorkshopState() {
  if (supabaseClient.isConnected()) {
    const res = await supabaseClient.loadAllFromSupabase();
    if (res.success) {
      const prompts = res.prompts || [];
      const title = res.settings?.workshopTitle || process.env.WORKSHOP_NAME || 'Google Antigravity workshop by T M Saravanan';
      const activePromptId = res.settings?.activePromptId || null;
      const broadcast = res.settings?.broadcast || null;

      // Update local fallback
      fallbackStore.prompts = prompts;
      fallbackStore.workshopTitle = title;
      fallbackStore.activePromptId = activePromptId;
      fallbackStore.broadcast = broadcast;
      saveFallback();

      return {
        prompts,
        workshopTitle: title,
        activePromptId,
        broadcast
      };
    }
  }

  // Fallback to local memory
  return {
    prompts: fallbackStore.prompts || [],
    workshopTitle: fallbackStore.workshopTitle || process.env.WORKSHOP_NAME || 'Google Antigravity workshop by T M Saravanan',
    activePromptId: fallbackStore.activePromptId || null,
    broadcast: fallbackStore.broadcast || null
  };
}

// ---------------- PARTICIPANT ROUTES ----------------

// Get workshop public state (only deployed prompts, active prompt, broadcast)
app.get('/api/workshop', async (req, res) => {
  const state = await getLiveWorkshopState();

  const deployedPrompts = state.prompts
    .filter(p => p.status === 'deployed')
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const activePrompt = (state.activePromptId && state.activePromptId !== 'null' && state.activePromptId !== 'none')
    ? (deployedPrompts.find(p => p.id === state.activePromptId) || null)
    : null;

  res.json({
    workshopTitle: state.workshopTitle,
    activePrompt,
    activePromptId: activePrompt ? activePrompt.id : null,
    deployedCount: deployedPrompts.length,
    history: deployedPrompts,
    broadcast: state.broadcast,
    connectedParticipants: sseClients.size
  });
});

// SSE Stream for live real-time push to participants and admin
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const client = { id: Date.now() + Math.random().toString(36).substr(2, 5), res };
  sseClients.add(client);

  res.write(`event: init\ndata: ${JSON.stringify({ connected: sseClients.size })}\n\n`);
  broadcastEvent('stats', { connected: sseClients.size });

  req.on('close', () => {
    sseClients.delete(client);
    broadcastEvent('stats', { connected: sseClients.size });
  });
});

// Keep SSE alive every 20s
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(': keepalive\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 20000);

// ---------------- ADMIN AUTH & MIDDLEWARE ----------------

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Password' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect password' });
  }
});

// ---------------- ADMIN MANAGEMENT ROUTES ----------------

// Get all prompts (drafts + deployed) directly from Supabase
app.get('/api/admin/prompts', adminAuth, async (req, res) => {
  const state = await getLiveWorkshopState();
  const localIps = getLocalIpAddresses();
  const sorted = [...state.prompts].sort((a, b) => (a.order || 0) - (b.order || 0));

  res.json({
    workshopTitle: state.workshopTitle,
    activePromptId: state.activePromptId,
    prompts: sorted,
    broadcast: state.broadcast,
    connectedParticipants: sseClients.size,
    serverPort: PORT,
    localIps: localIps.map(ip => `http://${ip}:${PORT}`),
    localUrl: `http://localhost:${PORT}`,
    supabase: {
      isConnected: supabaseClient.isConnected(),
      ...supabaseClient.getConfig()
    }
  });
});

// Add new prompt
app.post('/api/admin/prompts', adminAuth, async (req, res) => {
  const { title, content, notes, whyItWorks, howNotToPrompt, deployImmediately } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and Prompt content are required.' });
  }

  const state = await getLiveWorkshopState();
  const maxOrder = state.prompts.reduce((max, p) => Math.max(max, p.order || 0), 0);
  const newId = 'p-' + Date.now();

  const newPrompt = {
    id: newId,
    title: title.trim(),
    content: content.trim(),
    notes: (notes || '').trim(),
    whyItWorks: (whyItWorks || '').trim(),
    howNotToPrompt: (howNotToPrompt || '').trim(),
    status: deployImmediately ? 'deployed' : 'draft',
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
    deployedAt: deployImmediately ? new Date().toISOString() : null
  };

  // 1. Save directly to Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.savePrompt(newPrompt);
    if (deployImmediately) {
      await supabaseClient.saveSettings(state.workshopTitle, newId, state.broadcast);
    }
  }

  // 2. Update local fallback
  fallbackStore.prompts.push(newPrompt);
  if (deployImmediately) fallbackStore.activePromptId = newId;
  saveFallback();

  // 3. Broadcast real-time event
  if (deployImmediately) {
    broadcastEvent('prompt:deployed', {
      prompt: newPrompt,
      workshopTitle: state.workshopTitle
    });
  }

  res.status(201).json({ success: true, prompt: newPrompt });
});

// Update prompt
app.put('/api/admin/prompts/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const state = await getLiveWorkshopState();
  const prompt = state.prompts.find(p => p.id === id);

  if (!prompt) {
    return res.status(404).json({ error: 'Prompt not found.' });
  }

  const { title, content, notes, whyItWorks, howNotToPrompt, order } = req.body;
  if (title !== undefined) prompt.title = title.trim();
  if (content !== undefined) prompt.content = content.trim();
  if (notes !== undefined) prompt.notes = notes.trim();
  if (whyItWorks !== undefined) prompt.whyItWorks = whyItWorks.trim();
  if (howNotToPrompt !== undefined) prompt.howNotToPrompt = howNotToPrompt.trim();
  if (order !== undefined) prompt.order = Number(order);

  // 1. Save to Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.savePrompt(prompt);
  }

  // 2. Update local fallback
  const idx = fallbackStore.prompts.findIndex(p => p.id === id);
  if (idx !== -1) fallbackStore.prompts[idx] = prompt;
  saveFallback();

  // 3. If active prompt, update and broadcast
  if (state.activePromptId === id) {
    broadcastEvent('prompt:deployed', {
      prompt,
      workshopTitle: state.workshopTitle
    });
    if (supabaseClient.isConnected()) {
      await supabaseClient.saveSettings(state.workshopTitle, id, state.broadcast);
    }
  }

  res.json({ success: true, prompt });
});

// Deploy a prompt (upload / publish it live to participants)
app.post('/api/admin/prompts/:id/deploy', adminAuth, async (req, res) => {
  const { id } = req.params;
  const state = await getLiveWorkshopState();
  const prompt = state.prompts.find(p => p.id === id);

  if (!prompt) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  prompt.status = 'deployed';
  prompt.deployedAt = new Date().toISOString();

  // 1. Save to Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.savePrompt(prompt);
    await supabaseClient.saveSettings(state.workshopTitle, id, state.broadcast);
  }

  // 2. Update local fallback
  const idx = fallbackStore.prompts.findIndex(p => p.id === id);
  if (idx !== -1) fallbackStore.prompts[idx] = prompt;
  fallbackStore.activePromptId = id;
  saveFallback();

  // 3. Broadcast real-time
  broadcastEvent('prompt:deployed', {
    prompt,
    workshopTitle: state.workshopTitle
  });

  res.json({ success: true, message: `Prompt "${prompt.title}" is now LIVE!`, prompt });
});

// Remove / clear active prompt from participant screens (keep prompt in history)
app.post('/api/admin/prompts/clear-active', adminAuth, async (req, res) => {
  const state = await getLiveWorkshopState();

  // 1. Save to Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.saveSettings(state.workshopTitle, null, state.broadcast);
  }

  // 2. Update local fallback
  fallbackStore.activePromptId = null;
  saveFallback();

  // 3. Broadcast real-time to all connected screens
  broadcastEvent('prompt:cleared', {
    prompt: null,
    workshopTitle: state.workshopTitle
  });
  broadcastEvent('prompt:deployed', {
    prompt: null,
    workshopTitle: state.workshopTitle
  });

  res.json({ success: true, message: 'Active prompt removed from participant screens' });
});

// Undeploy a prompt (set status back to draft and remove from screen if active)
app.post('/api/admin/prompts/:id/undeploy', adminAuth, async (req, res) => {
  const { id } = req.params;
  const state = await getLiveWorkshopState();
  const prompt = state.prompts.find(p => p.id === id);

  if (!prompt) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  prompt.status = 'draft';
  prompt.deployedAt = null;

  const wasActive = state.activePromptId === id;

  // 1. Save to Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.savePrompt(prompt);
    if (wasActive) {
      await supabaseClient.saveSettings(state.workshopTitle, null, state.broadcast);
    }
  }

  // 2. Update local fallback
  const idx = fallbackStore.prompts.findIndex(p => p.id === id);
  if (idx !== -1) fallbackStore.prompts[idx] = prompt;
  if (wasActive) fallbackStore.activePromptId = null;
  saveFallback();

  // 3. Broadcast real-time if active prompt was undeployed
  if (wasActive) {
    broadcastEvent('prompt:cleared', {
      prompt: null,
      workshopTitle: state.workshopTitle
    });
    broadcastEvent('prompt:deployed', {
      prompt: null,
      workshopTitle: state.workshopTitle
    });
  }

  res.json({ success: true, message: `Prompt "${prompt.title}" moved to draft and removed from screens.`, prompt });
});

// Delete prompt
app.delete('/api/admin/prompts/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const state = await getLiveWorkshopState();

  // 1. Delete from Supabase
  if (supabaseClient.isConnected()) {
    await supabaseClient.deletePrompt(id);
  }

  // 2. Delete from local fallback
  const idx = fallbackStore.prompts.findIndex(p => p.id === id);
  if (idx !== -1) fallbackStore.prompts.splice(idx, 1);

  // 3. If this was the active prompt, switch to the last deployed or null
  if (state.activePromptId === id) {
    const remainingDeployed = fallbackStore.prompts.filter(p => p.status === 'deployed');
    const nextActive = remainingDeployed.length > 0 ? remainingDeployed[remainingDeployed.length - 1] : null;
    const nextId = nextActive ? nextActive.id : null;

    fallbackStore.activePromptId = nextId;

    if (supabaseClient.isConnected()) {
      await supabaseClient.saveSettings(state.workshopTitle, nextId, state.broadcast);
    }

    broadcastEvent('prompt:deployed', {
      prompt: nextActive,
      workshopTitle: state.workshopTitle
    });
    if (!nextActive) {
      broadcastEvent('prompt:cleared', {
        prompt: null,
        workshopTitle: state.workshopTitle
      });
    }
  }

  saveFallback();
  res.json({ success: true, message: 'Prompt deleted' });
});

// Broadcast announcement to participant screens
app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const { message, durationSec = 15 } = req.body;
  const broadcastObj = message ? { text: message, timestamp: Date.now(), durationSec } : null;

  const state = await getLiveWorkshopState();

  if (supabaseClient.isConnected()) {
    await supabaseClient.saveSettings(state.workshopTitle, state.activePromptId, broadcastObj);
  }

  fallbackStore.broadcast = broadcastObj;
  saveFallback();

  broadcastEvent('broadcast:alert', broadcastObj);
  res.json({ success: true, broadcast: broadcastObj });
});

// Update workshop settings
app.post('/api/admin/settings', adminAuth, async (req, res) => {
  const { workshopTitle } = req.body;
  if (workshopTitle) {
    const trimmedTitle = workshopTitle.trim();
    const state = await getLiveWorkshopState();

    if (supabaseClient.isConnected()) {
      await supabaseClient.saveSettings(trimmedTitle, state.activePromptId, state.broadcast);
    }

    fallbackStore.workshopTitle = trimmedTitle;
    saveFallback();

    broadcastEvent('workshop:updated', { workshopTitle: trimmedTitle });
  }
  res.json({ success: true, workshopTitle: fallbackStore.workshopTitle });
});

// Reorder prompts
app.post('/api/admin/reorder', adminAuth, async (req, res) => {
  const { orderedIds } = req.body;
  if (Array.isArray(orderedIds)) {
    const state = await getLiveWorkshopState();

    if (supabaseClient.isConnected()) {
      const updates = orderedIds.map((id, index) => {
        const p = state.prompts.find(item => item.id === id);
        if (p) {
          p.order = index + 1;
          return supabaseClient.savePrompt(p);
        }
        return Promise.resolve();
      });
      await Promise.all(updates);
    }

    orderedIds.forEach((id, index) => {
      const p = fallbackStore.prompts.find(item => item.id === id);
      if (p) p.order = index + 1;
    });
    saveFallback();
  }
  res.json({ success: true, message: 'Reordered successfully' });
});

// Clear prompt history for participants (archives/moves previous deployed prompts to draft)
app.post('/api/admin/clear-history', adminAuth, async (req, res) => {
  const state = await getLiveWorkshopState();
  const activeId = state.activePromptId;

  // Prompts to undeploy: all deployed prompts EXCEPT the currently active one (or all if keepActive is false)
  const { keepActive = true } = req.body;

  let clearedCount = 0;
  const updates = [];

  for (const prompt of state.prompts) {
    if (prompt.status === 'deployed') {
      const isActive = activeId && prompt.id === activeId;
      if (!keepActive || !isActive) {
        prompt.status = 'draft';
        prompt.deployedAt = null;
        clearedCount++;
        if (supabaseClient.isConnected()) {
          updates.push(supabaseClient.savePrompt(prompt));
        }
      }
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  // Update fallbackStore
  for (const prompt of fallbackStore.prompts) {
    if (prompt.status === 'deployed') {
      const isActive = activeId && prompt.id === activeId;
      if (!keepActive || !isActive) {
        prompt.status = 'draft';
        prompt.deployedAt = null;
      }
    }
  }
  saveFallback();

  // Real-time broadcast to all connected participant browsers to immediately clear their history drawer
  broadcastEvent('history:cleared', {
    clearedCount,
    activePromptId: activeId
  });

  res.json({
    success: true,
    message: `Cleared ${clearedCount} prompt${clearedCount === 1 ? '' : 's'} from participant history.`,
    clearedCount
  });
});

// Server info / IP address for sharing
app.get('/api/admin/network', adminAuth, (req, res) => {
  const ips = getLocalIpAddresses();
  res.json({
    port: PORT,
    localIps: ips.map(ip => `http://${ip}:${PORT}`),
    localUrl: `http://localhost:${PORT}`
  });
});

// ---------------- SUPABASE CONFIG & SYNC ROUTES ----------------

// Get Supabase status
app.get('/api/admin/supabase-status', adminAuth, async (req, res) => {
  const cfg = supabaseClient.getConfig();
  const isConn = supabaseClient.isConnected();
  let dbCheck = null;

  if (isConn) {
    dbCheck = await supabaseClient.loadAllFromSupabase();
  }

  res.json({
    connected: isConn,
    url: cfg.url,
    hasKey: cfg.hasKey,
    keyPreview: cfg.keyPreview,
    promptsInSupabase: dbCheck?.prompts ? dbCheck.prompts.length : 0,
    dbCheck: dbCheck?.success ? 'OK' : (dbCheck?.error || 'Not tested'),
    promptsInLocal: fallbackStore.prompts.length
  });
});

// Configure Supabase Key / URL from Admin UI
app.post('/api/admin/supabase-config', adminAuth, async (req, res) => {
  const { supabaseUrl, supabaseKey } = req.body;

  const url = (supabaseUrl || process.env.SUPABASE_URL || 'https://osifexxyqaadkwqrmgds.supabase.co').trim();
  const key = (supabaseKey || '').trim();

  if (!key) {
    return res.status(400).json({ error: 'Supabase API Key (anon or service_role) is required.' });
  }

  const initialized = supabaseClient.initSupabase(url, key);
  if (!initialized) {
    return res.status(400).json({ error: 'Failed to initialize Supabase client with provided credentials.' });
  }

  if (!process.env.VERCEL) {
    try {
      let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
      if (envContent.includes('SUPABASE_URL=')) {
        envContent = envContent.replace(/SUPABASE_URL=.*/g, `SUPABASE_URL=${url}`);
      } else {
        envContent += `\nSUPABASE_URL=${url}`;
      }

      if (envContent.includes('SUPABASE_KEY=')) {
        envContent = envContent.replace(/SUPABASE_KEY=.*/g, `SUPABASE_KEY=${key}`);
      } else {
        envContent += `\nSUPABASE_KEY=${key}`;
      }
      fs.writeFileSync(ENV_FILE, envContent.trim() + '\n', 'utf8');
    } catch (err) {
      // Ignore in serverless
    }
  }

  res.json({
    success: true,
    message: 'Supabase configured successfully!',
    connected: supabaseClient.isConnected(),
    url
  });
});

// Manual trigger to sync local data to Supabase
app.post('/api/admin/supabase-sync', adminAuth, async (req, res) => {
  if (!supabaseClient.isConnected()) {
    return res.status(400).json({ error: 'Supabase is not connected. Please provide an API key.' });
  }

  const { direction = 'pull' } = req.body;

  if (direction === 'push') {
    const result = await supabaseClient.syncAllToSupabase(fallbackStore);
    return res.json({ success: result.success, message: `Pushed ${fallbackStore.prompts.length} prompts to Supabase`, details: result });
  } else {
    const result = await supabaseClient.loadAllFromSupabase();
    if (result.success && result.prompts) {
      fallbackStore.prompts = result.prompts;
      if (result.settings?.workshopTitle) fallbackStore.workshopTitle = result.settings.workshopTitle;
      if (result.settings?.activePromptId) fallbackStore.activePromptId = result.settings.activePromptId;
      saveFallback();
      return res.json({ success: true, message: `Loaded ${result.prompts.length} prompts from Supabase`, prompts: fallbackStore.prompts });
    } else {
      return res.status(500).json({ success: false, error: result.error || 'Failed to pull from Supabase' });
    }
  }
});

// Start Server locally
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log(`\n======================================================`);
    console.log(`🚀 Workshop Live Prompts Server Running!`);
    console.log(`------------------------------------------------------`);
    console.log(`👥 Participants URL:  http://localhost:${PORT}`);
    ips.forEach(ip => {
      console.log(`👥 Participants Wi-Fi: http://${ip}:${PORT}`);
    });
    console.log(`🔐 Admin Control Center: http://localhost:${PORT}/admin.html`);
    console.log(`⚡ Supabase Database:    ${supabaseClient.getConfig().url}`);
    console.log(`   Connection Status:   ${supabaseClient.isConnected() ? 'CONNECTED ✅' : 'WAITING FOR API KEY ⚠️'}`);
    console.log(`🔑 Admin Password:       ${ADMIN_PASSWORD}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
