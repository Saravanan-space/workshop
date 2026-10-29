// ========================================================
// WORKSHOP ADMIN COMMAND CENTER - CLEAN CONTROLLER
// ========================================================

let adminPassword = localStorage.getItem('workshop_admin_pass') || '';
let currentData = {
  workshopTitle: '',
  activePromptId: null,
  prompts: [],
  connectedParticipants: 0,
  localIps: [],
  localUrl: ''
};
let currentFilter = 'all';
let eventSource = null;

// DOM Elements
const authOverlay = document.getElementById('authOverlay');
const adminApp = document.getElementById('adminApp');
const authForm = document.getElementById('authForm');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const authError = document.getElementById('authError');
const logoutBtn = document.getElementById('logoutBtn');

// Header elements
const headerWorkshopTitle = document.getElementById('headerWorkshopTitle');
const participantCount = document.getElementById('participantCount');
const activePromptTag = document.getElementById('activePromptTag');
const shareUrlBtn = document.getElementById('shareUrlBtn');
const adminThemeToggleBtn = document.getElementById('adminThemeToggleBtn');
const adminThemeIcon = document.getElementById('adminThemeIcon');
const adminThemeLabel = document.getElementById('adminThemeLabel');
let adminTheme = localStorage.getItem('workshop_theme') || 'light';

// Creator form elements
const promptForm = document.getElementById('promptForm');
const formTitle = document.getElementById('formTitle');
const editingPromptId = document.getElementById('editingPromptId');
const promptTitle = document.getElementById('promptTitle');
const promptContent = document.getElementById('promptContent');
const promptWhyItWorks = document.getElementById('promptWhyItWorks');
const promptHowNotToPrompt = document.getElementById('promptHowNotToPrompt');
const promptNotes = document.getElementById('promptNotes');
const charCount = document.getElementById('charCount');
const wordCount = document.getElementById('wordCount');
const clearFormBtn = document.getElementById('clearFormBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const deployImmediatelyBtn = document.getElementById('deployImmediatelyBtn');

// Broadcast elements
const broadcastMessageInput = document.getElementById('broadcastMessageInput');
const sendBroadcastBtn = document.getElementById('sendBroadcastBtn');
const clearBroadcastBtn = document.getElementById('clearBroadcastBtn');

// Spotlight & Bank elements
const livePromptSpotlight = document.getElementById('livePromptSpotlight');
const refreshDataBtn = document.getElementById('refreshDataBtn');
const promptsList = document.getElementById('promptsList');
const promptSearchInput = document.getElementById('promptSearchInput');
const totalPromptsCount = document.getElementById('totalPromptsCount');
const filterAllCount = document.getElementById('filterAllCount');
const filterDeployedCount = document.getElementById('filterDeployedCount');
const filterDraftCount = document.getElementById('filterDraftCount');
const filterPills = document.querySelectorAll('.filter-pill');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const importJsonInput = document.getElementById('importJsonInput');

// Modal elements
const shareModal = document.getElementById('shareModal');
const closeShareModalBtn = document.getElementById('closeShareModalBtn');
const localIpUrlsList = document.getElementById('localIpUrlsList');

// Toast
const toastContainer = document.getElementById('toastContainer');

// ---------------- INITIALIZATION ----------------

document.addEventListener('DOMContentLoaded', () => {
  initAdminTheme();
  setupEventListeners();
  if (adminPassword) {
    verifyAndInit();
  }
});

function initAdminTheme() {
  document.documentElement.setAttribute('data-theme', adminTheme);
  updateAdminThemeUI();
}

function updateAdminThemeUI() {
  if (adminTheme === 'dark') {
    adminThemeIcon.textContent = '🌙';
    adminThemeLabel.textContent = 'Dark';
  } else {
    adminThemeIcon.textContent = '☀️';
    adminThemeLabel.textContent = 'Light';
  }
}

function setupEventListeners() {
  // Theme Toggle
  if (adminThemeToggleBtn) {
    adminThemeToggleBtn.addEventListener('click', () => {
      adminTheme = adminTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('workshop_theme', adminTheme);
      document.documentElement.setAttribute('data-theme', adminTheme);
      updateAdminThemeUI();
      showToast(`Switched to ${adminTheme} mode`);
    });
  }

  // Auth
  authForm.addEventListener('submit', handleLogin);
  togglePasswordBtn.addEventListener('click', () => {
    const isPass = adminPasswordInput.type === 'password';
    adminPasswordInput.type = isPass ? 'text' : 'password';
    togglePasswordBtn.textContent = isPass ? '🔒' : '👁️';
  });
  logoutBtn.addEventListener('click', handleLogout);

  // Workshop Title Edit
  headerWorkshopTitle.addEventListener('click', handleEditWorkshopTitle);

  // Form Stats
  promptContent.addEventListener('input', updateContentStats);

  // Form Submission
  promptForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSavePrompt(false);
  });
  deployImmediatelyBtn.addEventListener('click', () => {
    handleSavePrompt(true);
  });
  clearFormBtn.addEventListener('click', resetForm);

  // Broadcast
  sendBroadcastBtn.addEventListener('click', handleSendBroadcast);
  clearBroadcastBtn.addEventListener('click', handleClearBroadcast);

  // Filters & Search
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      renderPromptsList();
    });
  });
  promptSearchInput.addEventListener('input', renderPromptsList);
  refreshDataBtn.addEventListener('click', fetchWorkshopData);

  // Export / Import
  exportJsonBtn.addEventListener('click', handleExportJson);
  importJsonInput.addEventListener('change', handleImportJson);

  // Modal
  shareUrlBtn.addEventListener('click', openShareModal);
  closeShareModalBtn.addEventListener('click', () => shareModal.classList.add('hidden'));
  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
  });

  // Copy buttons
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy');
    if (copyBtn) {
      const targetId = copyBtn.dataset.copyTarget;
      const targetInput = document.getElementById(targetId);
      if (targetInput) {
        copyToClipboard(targetInput.value);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('btn-success');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('btn-success');
        }, 2000);
      }
    }
  });

  // Supabase modal listeners
  const supabaseBtn = document.getElementById('supabaseBtn');
  const supabaseModal = document.getElementById('supabaseModal');
  const closeSupabaseModalBtn = document.getElementById('closeSupabaseModalBtn');
  const saveSupabaseKeyBtn = document.getElementById('saveSupabaseKeyBtn');
  const btnSupabasePush = document.getElementById('btnSupabasePush');
  const btnSupabasePull = document.getElementById('btnSupabasePull');

  if (supabaseBtn) {
    supabaseBtn.addEventListener('click', () => {
      if (supabaseModal) supabaseModal.classList.remove('hidden');
      checkSupabaseStatus();
    });
  }
  if (closeSupabaseModalBtn) {
    closeSupabaseModalBtn.addEventListener('click', () => {
      if (supabaseModal) supabaseModal.classList.add('hidden');
    });
  }
  if (supabaseModal) {
    supabaseModal.addEventListener('click', (e) => {
      if (e.target === supabaseModal) supabaseModal.classList.add('hidden');
    });
  }
  if (saveSupabaseKeyBtn) {
    saveSupabaseKeyBtn.addEventListener('click', handleSaveSupabaseKey);
  }
  if (btnSupabasePush) {
    btnSupabasePush.addEventListener('click', handleSupabasePush);
  }
  if (btnSupabasePull) {
    btnSupabasePull.addEventListener('click', handleSupabasePull);
  }
}

// ---------------- AUTHENTICATION ----------------

async function handleLogin(e) {
  e.preventDefault();
  const password = adminPasswordInput.value.trim();
  if (!password) return;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      adminPassword = password;
      localStorage.setItem('workshop_admin_pass', password);
      authOverlay.classList.remove('active');
      authOverlay.classList.add('hidden');
      adminApp.classList.remove('hidden');
      authError.classList.add('hidden');
      initAdminSession();
    } else {
      authError.textContent = data.error || 'Invalid password. Check your .env file.';
      authError.classList.remove('hidden');
    }
  } catch {
    authError.textContent = 'Network error connecting to workshop server.';
    authError.classList.remove('hidden');
  }
}

async function verifyAndInit() {
  try {
    const res = await fetch('/api/admin/prompts', {
      headers: { 'x-admin-password': adminPassword }
    });
    if (res.ok) {
      authOverlay.classList.remove('active');
      authOverlay.classList.add('hidden');
      adminApp.classList.remove('hidden');
      initAdminSession();
    } else {
      localStorage.removeItem('workshop_admin_pass');
      adminPassword = '';
    }
  } catch (err) {
    console.error('Verify error:', err);
  }
}

function handleLogout() {
  localStorage.removeItem('workshop_admin_pass');
  adminPassword = '';
  if (eventSource) eventSource.close();
  window.location.reload();
}

// ---------------- DATA & SSE STREAM ----------------

function initAdminSession() {
  fetchWorkshopData();
  setupRealtimeStream();
  checkSupabaseStatus();
}

async function fetchWorkshopData() {
  try {
    const res = await fetch('/api/admin/prompts', {
      headers: { 'x-admin-password': adminPassword }
    });
    if (!res.ok) {
      if (res.status === 401) handleLogout();
      return;
    }
    const data = await res.json();
    currentData = data;
    updateUI();
  } catch (err) {
    console.error('Failed to fetch data:', err);
    showToast('Failed to load workshop data', 'error');
  }
}

function setupRealtimeStream() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('stats', (e) => {
    try {
      const stats = JSON.parse(e.data);
      currentData.connectedParticipants = stats.connected;
      participantCount.textContent = stats.connected;
    } catch {}
  });

  eventSource.addEventListener('prompt:deployed', (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.prompt) {
        currentData.activePromptId = payload.prompt.id;
        const p = currentData.prompts.find(x => x.id === payload.prompt.id);
        if (p) {
          p.status = 'deployed';
          p.deployedAt = payload.prompt.deployedAt;
        }
      }
      updateUI();
    } catch {}
  });

  eventSource.onerror = () => {
    console.warn('Realtime stream disconnected, retrying...');
  };
}

// ---------------- UI RENDERING ----------------

function updateUI() {
  headerWorkshopTitle.textContent = currentData.workshopTitle || 'Workshop Command Center';
  participantCount.textContent = currentData.connectedParticipants || 0;

  // Active prompt tag in header
  const activePrompt = currentData.prompts.find(p => p.id === currentData.activePromptId);
  if (activePrompt) {
    activePromptTag.textContent = activePrompt.title;
    renderSpotlight(activePrompt);
  } else {
    activePromptTag.textContent = 'None';
    renderEmptySpotlight();
  }

  // Update counts
  const total = currentData.prompts.length;
  const deployed = currentData.prompts.filter(p => p.status === 'deployed').length;
  const drafts = total - deployed;

  totalPromptsCount.textContent = total;
  filterAllCount.textContent = total;
  filterDeployedCount.textContent = deployed;
  filterDraftCount.textContent = drafts;

  renderPromptsList();
}

function renderSpotlight(prompt) {
  livePromptSpotlight.className = 'spotlight-content';
  livePromptSpotlight.innerHTML = `
    <div class="spotlight-active-box">
      <div class="spotlight-title-row">
        <h3 class="spotlight-title">${escapeHtml(prompt.title)}</h3>
      </div>
      <div class="spotlight-preview">${escapeHtml(prompt.content)}</div>
      ${prompt.notes ? `<div class="spotlight-tip"><strong>💡 Note:</strong> ${escapeHtml(prompt.notes)}</div>` : ''}
    </div>
  `;
}

function renderEmptySpotlight() {
  livePromptSpotlight.className = 'spotlight-content empty-spotlight';
  livePromptSpotlight.innerHTML = `
    <div class="spotlight-placeholder">
      <span class="placeholder-icon">📡</span>
      <h4>No prompt currently live</h4>
      <p>Click <strong>"🚀 Deploy to Live"</strong> on any prompt below to push it to participant screens instantly.</p>
    </div>
  `;
}

function renderPromptsList() {
  const searchQuery = (promptSearchInput.value || '').toLowerCase().trim();

  let list = [...currentData.prompts];

  // Filter by status
  if (currentFilter === 'deployed') {
    list = list.filter(p => p.status === 'deployed');
  } else if (currentFilter === 'draft') {
    list = list.filter(p => p.status !== 'deployed');
  }

  // Search filter
  if (searchQuery) {
    list = list.filter(p =>
      p.title.toLowerCase().includes(searchQuery) ||
      p.content.toLowerCase().includes(searchQuery)
    );
  }

  if (list.length === 0) {
    promptsList.innerHTML = `
      <div class="glass-panel" style="padding: 24px; text-align: center; color: var(--text-muted);">
        <p>No prompts match the current filter or search.</p>
      </div>
    `;
    return;
  }

  promptsList.innerHTML = list.map(p => {
    const isLive = p.id === currentData.activePromptId;
    const isDeployed = p.status === 'deployed';

    return `
      <div class="prompt-card ${isLive ? 'is-active-deployed' : ''}" data-id="${p.id}">
        <div class="prompt-card-header">
          <div class="prompt-info-left">
            <span class="status-badge ${isDeployed ? 'deployed' : 'draft'}">
              ${isLive ? '🟢 CURRENTLY LIVE' : (isDeployed ? '✓ DEPLOYED' : '🟡 DRAFT')}
            </span>
            <h3 class="prompt-item-title">${escapeHtml(p.title)}</h3>
          </div>

          <div class="prompt-deploy-control">
            ${isLive ? `
              <span class="btn-deployed-active">
                <span>📡 Live on Screens</span>
              </span>
            ` : `
              <button class="btn-deploy-single" onclick="deployPrompt('${p.id}')">
                <span>🚀 Deploy to Live</span>
              </button>
            `}
          </div>
        </div>

        <div class="prompt-text-snippet">${escapeHtml(p.content)}</div>

        ${p.notes ? `
          <div class="prompt-notes-line">
            <span>💡</span>
            <span>${escapeHtml(p.notes)}</span>
          </div>
        ` : ''}

        <div class="prompt-card-footer">
          <div class="prompt-time">
            ${p.deployedAt ? `Deployed ${formatTime(p.deployedAt)}` : `Created ${formatTime(p.createdAt)}`}
          </div>
          <div class="item-actions-row">
            <button class="btn btn-sm btn-ghost" onclick="copyPromptText('${p.id}')" title="Copy prompt text">📋 Copy</button>
            <button class="btn btn-sm btn-ghost" onclick="editPrompt('${p.id}')" title="Edit prompt">✏️ Edit</button>
            <button class="btn btn-sm btn-ghost" onclick="deletePrompt('${p.id}')" title="Delete prompt" style="color: #f87171;">🗑️ Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------------- ACTIONS: DEPLOY, SAVE, EDIT, DELETE ----------------

async function deployPrompt(id) {
  try {
    const res = await fetch(`/api/admin/prompts/${id}/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`🚀 "${data.prompt.title}" is now LIVE on participant screens!`, 'success');
      currentData.activePromptId = id;
      const target = currentData.prompts.find(p => p.id === id);
      if (target) {
        target.status = 'deployed';
        target.deployedAt = new Date().toISOString();
      }
      updateUI();
    } else {
      showToast(data.error || 'Failed to deploy prompt', 'error');
    }
  } catch {
    showToast('Network error deploying prompt', 'error');
  }
}
window.deployPrompt = deployPrompt;

async function handleSavePrompt(deployImmediately = false) {
  const title = promptTitle.value.trim();
  const content = promptContent.value.trim();
  const whyItWorks = promptWhyItWorks.value.trim();
  const howNotToPrompt = promptHowNotToPrompt.value.trim();
  const notes = promptNotes.value.trim();
  const editId = editingPromptId.value;

  if (!title || !content) {
    showToast('Please provide both Title and Prompt Text', 'warning');
    return;
  }

  const payload = {
    title,
    content,
    whyItWorks,
    howNotToPrompt,
    notes,
    deployImmediately
  };

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/admin/prompts/${editId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok && (data.success || data.prompt)) {
      if (editId) {
        showToast('Prompt updated successfully!', 'success');
      } else if (deployImmediately) {
        showToast(`🚀 "${title}" saved and pushed LIVE!`, 'success');
      } else {
        showToast('Saved to queue as Draft.', 'success');
      }

      resetForm();
      fetchWorkshopData();
    } else {
      showToast(data.error || 'Failed to save prompt', 'error');
    }
  } catch {
    showToast('Error connecting to server', 'error');
  }
}

function editPrompt(id) {
  const p = currentData.prompts.find(x => x.id === id);
  if (!p) return;

  editingPromptId.value = p.id;
  promptTitle.value = p.title;
  promptContent.value = p.content;
  promptWhyItWorks.value = p.whyItWorks || '';
  promptHowNotToPrompt.value = p.howNotToPrompt || '';
  promptNotes.value = p.notes || '';
  formTitle.textContent = `Edit: ${p.title}`;
  saveDraftBtn.querySelector('span').textContent = 'Update Saved Prompt';
  deployImmediatelyBtn.querySelector('#deployBtnLabel').textContent = 'Update & Deploy Live';

  updateContentStats();
  promptForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  promptTitle.focus();
}
window.editPrompt = editPrompt;

async function deletePrompt(id) {
  const p = currentData.prompts.find(x => x.id === id);
  const name = p ? p.title : 'this prompt';
  if (!confirm(`Delete "${name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/prompts/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Prompt deleted', 'success');
      fetchWorkshopData();
    } else {
      showToast(data.error || 'Failed to delete', 'error');
    }
  } catch {
    showToast('Network error deleting prompt', 'error');
  }
}
window.deletePrompt = deletePrompt;

function copyPromptText(id) {
  const p = currentData.prompts.find(x => x.id === id);
  if (p) {
    copyToClipboard(p.content);
    showToast('Prompt text copied to clipboard!', 'success');
  }
}
window.copyPromptText = copyPromptText;

function resetForm() {
  editingPromptId.value = '';
  promptForm.reset();
  promptWhyItWorks.value = '';
  promptHowNotToPrompt.value = '';
  formTitle.textContent = 'Create & Queue Prompt';
  saveDraftBtn.querySelector('span').textContent = 'Save to Queue';
  deployImmediatelyBtn.querySelector('#deployBtnLabel').textContent = 'Upload & Deploy to Screen';
  updateContentStats();
}

function updateContentStats() {
  const text = promptContent.value;
  charCount.textContent = `${text.length} chars`;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  wordCount.textContent = `${words} words`;
}

// ---------------- BROADCAST & SETTINGS ----------------

async function handleSendBroadcast() {
  const message = broadcastMessageInput.value.trim();
  if (!message) {
    showToast('Enter a broadcast message first', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('📢 Broadcast banner sent to all participant screens!', 'success');
    }
  } catch {
    showToast('Failed to send broadcast', 'error');
  }
}

async function handleClearBroadcast() {
  try {
    await fetch('/api/admin/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ message: '' })
    });
    broadcastMessageInput.value = '';
    showToast('Broadcast banner cleared', 'success');
  } catch {}
}

async function handleEditWorkshopTitle() {
  const currentTitle = headerWorkshopTitle.textContent;
  const newTitle = prompt('Enter new Workshop Title:', currentTitle);
  if (!newTitle || newTitle.trim() === currentTitle) return;

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ workshopTitle: newTitle.trim() })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentData.workshopTitle = newTitle.trim();
      headerWorkshopTitle.textContent = newTitle.trim();
      showToast('Workshop title updated', 'success');
    }
  } catch {
    showToast('Failed to update title', 'error');
  }
}

// ---------------- EXPORT / IMPORT ----------------

function handleExportJson() {
  const exportPayload = {
    workshopTitle: currentData.workshopTitle,
    exportedAt: new Date().toISOString(),
    prompts: currentData.prompts
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workshop-prompts-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Prompts downloaded as JSON', 'success');
}

function handleImportJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      const promptsToAdd = Array.isArray(parsed) ? parsed : (parsed.prompts || []);

      if (!Array.isArray(promptsToAdd) || promptsToAdd.length === 0) {
        showToast('No valid prompts found in JSON file', 'error');
        return;
      }

      let count = 0;
      for (const p of promptsToAdd) {
        if (p.title && p.content) {
          await fetch('/api/admin/prompts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-password': adminPassword
            },
            body: JSON.stringify({
              title: p.title,
              content: p.content,
              whyItWorks: p.whyItWorks || '',
              howNotToPrompt: p.howNotToPrompt || '',
              notes: p.notes || '',
              deployImmediately: false
            })
          });
          count++;
        }
      }

      showToast(`Successfully imported ${count} prompts!`, 'success');
      fetchWorkshopData();
    } catch {
      showToast('Invalid JSON file format', 'error');
    }
  };
  reader.readAsText(file);
}

// ---------------- SHARE URL MODAL ----------------

function openShareModal() {
  const localIps = currentData.localIps || [];
  if (localIps.length === 0) {
    localIpUrlsList.innerHTML = `<p class="modal-info">No Wi-Fi address detected. Connect laptop to Wi-Fi/Hotspot.</p>`;
  } else {
    localIpUrlsList.innerHTML = localIps.map((ipUrl, idx) => `
      <div class="copy-input-row" style="margin-bottom: 8px;">
        <input type="text" id="wifiIp_${idx}" readonly value="${ipUrl}" />
        <button class="btn btn-primary btn-copy" data-copy-target="wifiIp_${idx}">Copy URL</button>
      </div>
    `).join('');
  }

  shareModal.classList.remove('hidden');
}

// ---------------- UTILITIES ----------------

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    try {
      document.execCommand('copy');
    } catch {}
    document.body.removeChild(temp);
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ---------------- SUPABASE INTEGRATION ----------------

async function checkSupabaseStatus() {
  try {
    const res = await fetch('/api/admin/supabase-status', {
      headers: { 'x-admin-password': adminPassword }
    });
    if (!res.ok) return;
    const data = await res.json();
    updateSupabaseUI(data);
  } catch (err) {
    console.error('Failed to check Supabase status:', err);
  }
}

function updateSupabaseUI(data) {
  const dot = document.getElementById('supabaseStatusDot');
  const text = document.getElementById('supabaseStatusText');
  const message = document.getElementById('supabaseStatusMessage');

  if (data.connected) {
    if (dot) {
      dot.className = 'metric-dot pulse-green';
    }
    if (text) text.textContent = 'Supabase: Connected';
    if (message) {
      message.innerHTML = `
        <div style="color: #4ade80; font-weight: 600; margin-bottom: 6px;">🟢 Connected to Supabase Database</div>
        <div style="margin-bottom: 3px;"><strong>URL:</strong> <code>${escapeHtml(data.url)}</code></div>
        <div style="margin-bottom: 3px;"><strong>Key:</strong> <code>${escapeHtml(data.keyPreview || 'Configured')}</code></div>
        <div style="margin-bottom: 3px;"><strong>Prompts in Cloud DB:</strong> ${data.promptsInSupabase} | <strong>Local Cache:</strong> ${data.promptsInLocal}</div>
        <div style="margin-top: 6px; color: #94a3b8; font-size: 11px;">DB Test: <strong>${escapeHtml(data.dbCheck)}</strong></div>
      `;
    }
  } else {
    if (dot) {
      dot.className = 'metric-dot pulse-yellow';
    }
    if (text) text.textContent = 'Supabase Setup';
    if (message) {
      message.innerHTML = `
        <div style="color: #f59e0b; font-weight: 600; margin-bottom: 6px;">⚠️ Waiting for API Key</div>
        <div style="margin-bottom: 4px;"><strong>URL:</strong> <code>${escapeHtml(data.url)}</code></div>
        <div style="margin-top: 4px; color: #cbd5e1; line-height: 1.4;">All prompts are currently persisting to your local data cache. Once you paste your Supabase Anon/Service Role Key above, all prompts will automatically sync and store directly into your Supabase cloud database!</div>
      `;
    }
  }
}

async function handleSaveSupabaseKey() {
  const keyInput = document.getElementById('supabaseApiKeyInput');
  const key = keyInput.value.trim();
  if (!key) {
    showToast('Please enter your Supabase API Key', 'error');
    return;
  }

  const saveBtn = document.getElementById('saveSupabaseKeyBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Connecting...';

  try {
    const res = await fetch('/api/admin/supabase-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({
        supabaseUrl: 'https://osifexxyqaadkwqrmgds.supabase.co',
        supabaseKey: key,
        pushLocalData: true
      })
    });

    const result = await res.json();
    if (res.ok && result.success) {
      showToast('Connected to Supabase! All prompts synced.', 'success');
      keyInput.value = '';
      checkSupabaseStatus();
      fetchWorkshopData();
    } else {
      showToast(result.error || 'Failed to connect to Supabase', 'error');
    }
  } catch (err) {
    showToast('Network error saving Supabase config', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Connect';
  }
}

async function handleSupabasePush() {
  const btn = document.getElementById('btnSupabasePush');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  try {
    const res = await fetch('/api/admin/supabase-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ direction: 'push' })
    });
    const result = await res.json();
    if (res.ok && result.success) {
      showToast(result.message || 'Pushed to Supabase', 'success');
      checkSupabaseStatus();
    } else {
      showToast(result.error || 'Push failed', 'error');
    }
  } catch (err) {
    showToast('Error syncing to Supabase', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆️ Push All to Supabase';
  }
}

async function handleSupabasePull() {
  const btn = document.getElementById('btnSupabasePull');
  btn.disabled = true;
  btn.textContent = 'Pulling...';

  try {
    const res = await fetch('/api/admin/supabase-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ direction: 'pull' })
    });
    const result = await res.json();
    if (res.ok && result.success) {
      showToast(result.message || 'Loaded from Supabase', 'success');
      fetchWorkshopData();
      checkSupabaseStatus();
    } else {
      showToast(result.error || 'Pull failed', 'error');
    }
  } catch (err) {
    showToast('Error pulling from Supabase', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇️ Pull From Supabase';
  }
}
