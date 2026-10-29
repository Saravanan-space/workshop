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

// In-memory data store with file persistence and Supabase synchronization
let store = {
  workshopTitle: process.env.WORKSHOP_NAME || 'Google Antigravity workshop by T M Saravanan',
  activePromptId: null,
  broadcast: null,
  prompts: []
};

// Load initial data from local file first (fast boot)
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      store = JSON.parse(raw);
    }
  } catch (err) {
    // Ignore error in serverless environment
  }
}

// Persist data locally as offline fallback / cache (skipped on Vercel read-only filesystem)
function saveData() {
  if (process.env.VERCEL) return;
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    // Ignore error in serverless read-only filesystem
  }
}

// Initial local load
loadData();

// Helper to ensure freshest data from Supabase (essential for Vercel serverless)
async function ensureFreshData() {
  if (supabaseClient.isConnected()) {
    const supa = await supabaseClient.loadAllFromSupabase();
    if (supa.success && supa.prompts) {
      store.prompts = supa.prompts;
      if (supa.settings) {
        if (supa.settings.workshopTitle) store.workshopTitle = supa.settings.workshopTitle;
        if (supa.settings.activePromptId !== undefined) store.activePromptId = supa.settings.activePromptId;
        if (supa.settings.broadcast !== undefined) store.broadcast = supa.settings.broadcast;
      }
      saveData();
    }
  }
}

// Initial async sync
ensureFreshData();

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

// ---------------- PARTICIPANT ROUTES ----------------

// Get workshop public state (only deployed prompts, active prompt, broadcast)
app.get('/api/workshop', async (req, res) => {
  // On serverless, ensure we get latest updates from Supabase
  await ensureFreshData();

  const deployedPrompts = (store.prompts || [])
    .filter(p => p.status === 'deployed')
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const activePrompt = deployedPrompts.find(p => p.id === store.activePromptId) || deployedPrompts[deployedPrompts.length - 1] || null;

  res.json({
    workshopTitle: store.workshopTitle,
    activePrompt,
    deployedCount: deployedPrompts.length,
    history: deployedPrompts,
    broadcast: store.broadcast,
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

// Get all prompts (drafts + deployed), network info, and Supabase status
app.get('/api/admin/prompts', adminAuth, async (req, res) => {
  await ensureFreshData();

  const localIps = getLocalIpAddresses();
  const sorted = [...(store.prompts || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  res.json({
    workshopTitle: store.workshopTitle,
    activePromptId: store.activePromptId,
    prompts: sorted,
    broadcast: store.broadcast,
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

  const newId = 'p-' + Date.now();
  const maxOrder = store.prompts.reduce((max, p) => Math.max(max, p.order || 0), 0);

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

  store.prompts.push(newPrompt);

  if (deployImmediately) {
    store.activePromptId = newId;
    broadcastEvent('prompt:deployed', {
      prompt: newPrompt,
      workshopTitle: store.workshopTitle
    });
  }

  saveData();

  // Await save to Supabase for serverless durability
  await supabaseClient.savePrompt(newPrompt);
  if (deployImmediately) {
    await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);
  }

  res.status(201).json({ success: true, prompt: newPrompt });
});

// Update prompt
app.put('/api/admin/prompts/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const prompt = store.prompts.find(p => p.id === id);

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

  saveData();

  // Await save to Supabase
  await supabaseClient.savePrompt(prompt);

  // If this was the active prompt, broadcast the updated content to participants
  if (store.activePromptId === id) {
    broadcastEvent('prompt:deployed', {
      prompt,
      workshopTitle: store.workshopTitle
    });
    await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);
  }

  res.json({ success: true, prompt });
});

// Deploy a prompt (upload / publish it live to participants)
app.post('/api/admin/prompts/:id/deploy', adminAuth, async (req, res) => {
  const { id } = req.params;
  const prompt = store.prompts.find(p => p.id === id);

  if (!prompt) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  prompt.status = 'deployed';
  prompt.deployedAt = new Date().toISOString();
  store.activePromptId = id;

  saveData();

  // Await save to Supabase
  await supabaseClient.savePrompt(prompt);
  await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);

  // Instant real-time push to all participant browsers
  broadcastEvent('prompt:deployed', {
    prompt,
    workshopTitle: store.workshopTitle
  });

  res.json({ success: true, message: `Prompt "${prompt.title}" is now LIVE!`, prompt });
});

// Delete prompt
app.delete('/api/admin/prompts/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const idx = store.prompts.findIndex(p => p.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  store.prompts.splice(idx, 1);

  if (store.activePromptId === id) {
    const deployed = store.prompts.filter(p => p.status === 'deployed');
    store.activePromptId = deployed.length > 0 ? deployed[deployed.length - 1].id : null;
    broadcastEvent('prompt:deployed', {
      prompt: deployed.length > 0 ? deployed[deployed.length - 1] : null,
      workshopTitle: store.workshopTitle
    });
  }

  saveData();

  // Await delete from Supabase
  await supabaseClient.deletePrompt(id);
  await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);

  res.json({ success: true, message: 'Prompt deleted' });
});

// Broadcast announcement to participant screens
app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const { message, durationSec = 15 } = req.body;
  store.broadcast = message ? { text: message, timestamp: Date.now(), durationSec } : null;

  saveData();
  await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);

  broadcastEvent('broadcast:alert', store.broadcast);
  res.json({ success: true, broadcast: store.broadcast });
});

// Update workshop settings
app.post('/api/admin/settings', adminAuth, async (req, res) => {
  const { workshopTitle } = req.body;
  if (workshopTitle) {
    store.workshopTitle = workshopTitle.trim();
    saveData();
    await supabaseClient.saveSettings(store.workshopTitle, store.activePromptId, store.broadcast);
    broadcastEvent('workshop:updated', { workshopTitle: store.workshopTitle });
  }
  res.json({ success: true, workshopTitle: store.workshopTitle });
});

// Reorder prompts
app.post('/api/admin/reorder', adminAuth, async (req, res) => {
  const { orderedIds } = req.body;
  if (Array.isArray(orderedIds)) {
    orderedIds.forEach((id, index) => {
      const p = store.prompts.find(item => item.id === id);
      if (p) p.order = index + 1;
    });
    saveData();

    // Async sync prompt orders to Supabase
    await Promise.all(store.prompts.map(p => supabaseClient.savePrompt(p)));
  }
  res.json({ success: true, prompts: store.prompts });
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
    promptsInLocal: store.prompts.length
  });
});

// Configure Supabase Key / URL from Admin UI
app.post('/api/admin/supabase-config', adminAuth, async (req, res) => {
  const { supabaseUrl, supabaseKey, pushLocalData } = req.body;

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

  let syncResult = null;
  if (pushLocalData) {
    syncResult = await supabaseClient.syncAllToSupabase(store);
  } else {
    syncResult = await supabaseClient.loadAllFromSupabase();
    if (syncResult.success && syncResult.prompts && syncResult.prompts.length > 0) {
      store.prompts = syncResult.prompts;
      if (syncResult.settings?.workshopTitle) store.workshopTitle = syncResult.settings.workshopTitle;
      if (syncResult.settings?.activePromptId) store.activePromptId = syncResult.settings.activePromptId;
      saveData();
    }
  }

  res.json({
    success: true,
    message: 'Supabase configured successfully!',
    connected: supabaseClient.isConnected(),
    url,
    syncResult
  });
});

// Manual trigger to sync local data to Supabase
app.post('/api/admin/supabase-sync', adminAuth, async (req, res) => {
  if (!supabaseClient.isConnected()) {
    return res.status(400).json({ error: 'Supabase is not connected. Please provide an API key.' });
  }

  const { direction = 'push' } = req.body;

  if (direction === 'push') {
    const result = await supabaseClient.syncAllToSupabase(store);
    return res.json({ success: result.success, message: `Pushed ${store.prompts.length} prompts to Supabase`, details: result });
  } else {
    const result = await supabaseClient.loadAllFromSupabase();
    if (result.success && result.prompts) {
      store.prompts = result.prompts;
      if (result.settings?.workshopTitle) store.workshopTitle = result.settings.workshopTitle;
      if (result.settings?.activePromptId) store.activePromptId = result.settings.activePromptId;
      saveData();
      return res.json({ success: true, message: `Loaded ${result.prompts.length} prompts from Supabase`, prompts: store.prompts });
    } else {
      return res.status(500).json({ success: false, error: result.error || 'Failed to pull from Supabase' });
    }
  }
});

// Start Server locally (Vercel serverless exports app without listening on a port)
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
