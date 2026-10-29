// ========================================================
// WORKSHOP PARTICIPANT LIVE PORTAL - SPLIT-SCREEN CONTROLLER
// Clean Editorial Theme with Light/Dark Mode Switch
// ========================================================

let currentActivePrompt = null;
let promptHistory = [];
let audioAlertsEnabled = localStorage.getItem('workshop_sound') !== 'false';
let currentTheme = localStorage.getItem('workshop_theme') || 'light';
let eventSource = null;

// DOM Elements
const workshopTitleEl = document.getElementById('workshopTitle');
const liveStatusPill = document.getElementById('liveStatusPill');
const liveStatusText = document.getElementById('liveStatusText');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeLabel = document.getElementById('themeLabel');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIcon = document.getElementById('soundIcon');
const openHistoryBtn = document.getElementById('openHistoryBtn');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyOverlay = document.getElementById('historyOverlay');
const historyCountEl = document.getElementById('historyCount');
const historyList = document.getElementById('historyList');

// Stage Sub-Header Elements
const stageStepPill = document.getElementById('stageStepPill');
const promptTitle = document.getElementById('promptTitle');
const promptWordStats = document.getElementById('promptWordStats');

// Left Pane Elements
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const promptView = document.getElementById('promptView');
const promptCode = document.getElementById('promptCode');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const copyIcon = document.getElementById('copyIcon');
const copyText = document.getElementById('copyText');
const presenterTipBox = document.getElementById('presenterTipBox');
const presenterTipText = document.getElementById('presenterTipText');

// Right Pane Elements
const whyItWorksContent = document.getElementById('whyItWorksContent');
const howNotToPromptContent = document.getElementById('howNotToPromptContent');

// Broadcast Elements
const broadcastBanner = document.getElementById('broadcastBanner');
const broadcastMessage = document.getElementById('broadcastMessage');
const dismissBroadcastBtn = document.getElementById('dismissBroadcastBtn');

// Toast
const participantToast = document.getElementById('participantToast');

// Screen Prompt Removal Elements
const removePromptUserBtn = document.getElementById('removePromptUserBtn');
const restorePromptBtn = document.getElementById('restorePromptBtn');
const emptyStateHeading = document.getElementById('emptyStateHeading');
const emptyStateText = document.getElementById('emptyStateText');
let userDismissedPrompt = false;

// ---------------- INITIALIZATION ----------------

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateSoundButtonUI();
  setupEventListeners();
  loadInitialState();
  initSSE();
});

function initTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeUI();
}

function updateThemeUI() {
  if (currentTheme === 'dark') {
    themeIcon.textContent = '🌙';
    themeLabel.textContent = 'Dark';
  } else {
    themeIcon.textContent = '☀️';
    themeLabel.textContent = 'Light';
  }
}

function setupEventListeners() {
  // Theme Toggle Switch
  themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('workshop_theme', currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeUI();
    showToast(`Switched to ${currentTheme} theme`);
  });

  // Hero Copy Button
  copyPromptBtn.addEventListener('click', () => {
    if (currentActivePrompt && currentActivePrompt.content) {
      handleCopyText(currentActivePrompt.content, copyPromptBtn, copyIcon, copyText);
    }
  });

  // Sound Toggle
  soundToggleBtn.addEventListener('click', () => {
    audioAlertsEnabled = !audioAlertsEnabled;
    localStorage.setItem('workshop_sound', audioAlertsEnabled);
    updateSoundButtonUI();
    if (audioAlertsEnabled) {
      playChime();
      showToast('🔔 Audio alerts enabled');
    } else {
      showToast('🔕 Audio alerts muted');
    }
  });

  // History Drawer Controls
  openHistoryBtn.addEventListener('click', () => {
    historyOverlay.classList.remove('hidden');
  });

  closeHistoryBtn.addEventListener('click', () => {
    historyOverlay.classList.add('hidden');
  });

  historyOverlay.addEventListener('click', (e) => {
    if (e.target === historyOverlay) {
      historyOverlay.classList.add('hidden');
    }
  });

  // Dismiss Broadcast
  dismissBroadcastBtn.addEventListener('click', () => {
    broadcastBanner.classList.add('hidden');
  });

  // Remove prompt from participant screen
  if (removePromptUserBtn) {
    removePromptUserBtn.addEventListener('click', handleUserRemovePrompt);
  }

  // Restore prompt to screen
  if (restorePromptBtn) {
    restorePromptBtn.addEventListener('click', handleRestorePrompt);
  }

  // Global Keyboard Shortcut: Ctrl+C / Cmd+C copies active prompt if nothing is selected
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const selectedText = window.getSelection().toString();
      if (!selectedText && currentActivePrompt) {
        handleCopyText(currentActivePrompt.content, copyPromptBtn, copyIcon, copyText);
      }
    }
  });
}

function updateSoundButtonUI() {
  if (audioAlertsEnabled) {
    soundIcon.textContent = '🔔';
    soundToggleBtn.querySelector('.btn-caption').textContent = 'Audio: ON';
  } else {
    soundIcon.textContent = '🔕';
    soundToggleBtn.querySelector('.btn-caption').textContent = 'Audio: OFF';
  }
}

// ---------------- API & SSE CONNECTION ----------------

async function loadInitialState() {
  try {
    const res = await fetch('/api/workshop');
    if (!res.ok) throw new Error('Failed to load workshop');
    const data = await res.json();

    if (data.workshopTitle) {
      document.title = `${data.workshopTitle} | Live Prompts`;
      workshopTitleEl.textContent = data.workshopTitle;
    }

    promptHistory = data.history || [];
    historyCountEl.textContent = promptHistory.length;
    renderHistory();

    if (data.activePrompt) {
      renderActivePrompt(data.activePrompt, false);
    } else {
      loadingState.classList.add('hidden');
      emptyState.classList.remove('hidden');
      promptView.classList.add('hidden');
    }

    if (data.broadcast && data.broadcast.text) {
      showBroadcast(data.broadcast.text);
    }
  } catch (err) {
    console.error('Failed to load state:', err);
    loadingState.innerHTML = `
      <p style="color: #ef4444;">⚠️ Connecting to workshop server...</p>
    `;
    setTimeout(loadInitialState, 3000);
  }
}

function initSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    if (liveStatusPill) liveStatusPill.style.opacity = '1';
    if (liveStatusText) liveStatusText.textContent = 'LIVE';
  };

  eventSource.addEventListener('prompt:deployed', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.prompt) {
        userDismissedPrompt = false;
        const isNew = !currentActivePrompt || currentActivePrompt.id !== data.prompt.id;
        renderActivePrompt(data.prompt, isNew);

        if (!promptHistory.some(p => p.id === data.prompt.id)) {
          promptHistory.push(data.prompt);
          historyCountEl.textContent = promptHistory.length;
          renderHistory();
        }

        if (isNew && audioAlertsEnabled) {
          playChime();
          showToast(`🚀 New Prompt: ${data.prompt.title}`);
        }
      } else {
        clearActivePrompt();
      }
    } catch (err) {
      console.error('Error handling prompt event:', err);
    }
  });

  eventSource.addEventListener('prompt:cleared', () => {
    clearActivePrompt();
  });

  eventSource.addEventListener('broadcast:alert', (e) => {
    try {
      const broadcast = JSON.parse(e.data);
      if (broadcast && broadcast.text) {
        showBroadcast(broadcast.text);
      } else {
        broadcastBanner.classList.add('hidden');
      }
    } catch {}
  });

  eventSource.addEventListener('workshop:updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.workshopTitle) {
        workshopTitleEl.textContent = data.workshopTitle;
        document.title = `${data.workshopTitle} | Live Prompts`;
      }
    } catch {}
  });

  eventSource.onerror = () => {
    if (liveStatusText) liveStatusText.textContent = 'RECONNECTING...';
  };

  // Vercel serverless heartbeat fallback: polls every 3.5 seconds
  setInterval(async () => {
    try {
      const res = await fetch('/api/workshop');
      if (!res.ok) return;
      const data = await res.json();
      if (data.activePrompt) {
        if (!userDismissedPrompt && (!currentActivePrompt || currentActivePrompt.id !== data.activePrompt.id || currentActivePrompt.content !== data.activePrompt.content)) {
          const isNew = !currentActivePrompt || currentActivePrompt.id !== data.activePrompt.id;
          renderActivePrompt(data.activePrompt, isNew);
          if (isNew && audioAlertsEnabled) {
            playChime();
            showToast(`🚀 New Prompt: ${data.activePrompt.title}`);
          }
        }
      } else if (currentActivePrompt && !userDismissedPrompt) {
        clearActivePrompt();
      }
      if (data.history && data.history.length !== promptHistory.length) {
        promptHistory = data.history;
        historyCountEl.textContent = promptHistory.length;
        renderHistory();
      }
      if (data.broadcast && data.broadcast.text) {
        showBroadcast(data.broadcast.text);
      } else {
        broadcastBanner.classList.add('hidden');
      }
      if (data.workshopTitle && workshopTitleEl.textContent !== data.workshopTitle) {
        workshopTitleEl.textContent = data.workshopTitle;
        document.title = `${data.workshopTitle} | Live Prompts`;
      }
    } catch {}
  }, 3500);
}

// ---------------- RENDERING & PROMPT CLEAR ----------------

function clearActivePrompt() {
  currentActivePrompt = null;
  userDismissedPrompt = false;

  loadingState.classList.add('hidden');
  promptView.classList.add('hidden');
  emptyState.classList.remove('hidden');

  if (emptyStateHeading) emptyStateHeading.textContent = 'Waiting for Host to Deploy Prompt';
  if (emptyStateText) emptyStateText.textContent = 'The prompt will appear on your screen immediately when deployed by the host.';
  if (restorePromptBtn) restorePromptBtn.classList.add('hidden');

  promptTitle.textContent = 'Waiting for Workshop Prompt...';
  stageStepPill.textContent = 'STANDBY';
  promptWordStats.textContent = '0 chars • 0 words';
}

function handleUserRemovePrompt() {
  userDismissedPrompt = true;
  loadingState.classList.add('hidden');
  promptView.classList.add('hidden');
  emptyState.classList.remove('hidden');

  if (emptyStateHeading) emptyStateHeading.textContent = 'Prompt Removed from Screen';
  if (emptyStateText) emptyStateText.textContent = 'You removed this prompt from your screen. You can restore it anytime or view past prompts in History.';
  if (restorePromptBtn) restorePromptBtn.classList.remove('hidden');

  promptTitle.textContent = 'Prompt Dismissed';
  stageStepPill.textContent = 'STANDBY';
  promptWordStats.textContent = '0 chars • 0 words';

  showToast('Prompt removed from your screen');
}

function handleRestorePrompt() {
  userDismissedPrompt = false;
  if (currentActivePrompt) {
    renderActivePrompt(currentActivePrompt, false);
    showToast('Prompt restored to screen');
  } else {
    showToast('Waiting for host to deploy prompt', 'warning');
  }
}

function renderActivePrompt(prompt, shouldAnimate = true) {
  currentActivePrompt = prompt;
  userDismissedPrompt = false;

  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  if (restorePromptBtn) restorePromptBtn.classList.add('hidden');
  promptView.classList.remove('hidden');

  // Subheader: remove "Module" or "Prompt" prefix from heading
  const cleanTitle = (prompt.title || '').replace(/^(?:module|prompt)\s*\d*\s*[:\-–—]\s*/i, '').trim();
  promptTitle.textContent = cleanTitle || prompt.title;
  stageStepPill.textContent = prompt.order ? `STEP ${prompt.order}` : 'LIVE PROMPT';

  // Left Pane: Code & Stats
  promptCode.textContent = prompt.content;
  const chars = prompt.content.length;
  const words = prompt.content.trim() ? prompt.content.trim().split(/\s+/).length : 0;
  promptWordStats.textContent = `${chars} chars • ${words} words`;

  // Presenter Note (Host Tip)
  const tipText = (prompt.presenterTip || prompt.notes || '').trim();
  if (tipText) {
    presenterTipText.textContent = tipText;
    presenterTipBox.classList.remove('hidden');
  } else {
    presenterTipBox.classList.add('hidden');
  }

  // Right Pane: Upper Section - Why This Prompt Works
  if (prompt.whyItWorks && prompt.whyItWorks.trim()) {
    whyItWorksContent.innerHTML = formatBulletContent(prompt.whyItWorks);
  } else {
    whyItWorksContent.innerHTML = `<div class="empty-section-hint">Presenter will explain the architecture and mechanics of this prompt during the live session.</div>`;
  }

  // Right Pane: Lower Section - How Not to Prompt
  if (prompt.howNotToPrompt && prompt.howNotToPrompt.trim()) {
    howNotToPromptContent.innerHTML = formatAntiPatternContent(prompt.howNotToPrompt);
  } else {
    howNotToPromptContent.innerHTML = `<div class="empty-section-hint">Anti-patterns and common failure modes will be covered live by the presenter.</div>`;
  }

  // Animation pulse
  if (shouldAnimate) {
    promptView.style.animation = 'none';
    promptView.offsetHeight;
    promptView.style.animation = 'pulseScale 0.3s ease';
  }
}

function formatBulletContent(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return lines.map(line => {
    const cleanLine = line.replace(/^(\d+\.|\-|\•)\s*/, '');
    const parts = cleanLine.split(':');
    if (parts.length > 1 && parts[0].length < 40) {
      return `<p style="margin-bottom: 8px;"><strong>• ${escapeHtml(parts[0].trim())}:</strong> ${escapeHtml(parts.slice(1).join(':').trim())}</p>`;
    }
    return `<p style="margin-bottom: 8px;">• ${escapeHtml(cleanLine)}</p>`;
  }).join('');
}

function formatAntiPatternContent(text) {
  if (!text || !text.trim()) {
    return `<div class="empty-section-hint">Anti-patterns and common failure modes will be covered live by the presenter.</div>`;
  }

  const rawText = text.trim();
  let badPrompt = '';
  let explanation = '';

  // Split on "Why it/this fails"
  const splitMatch = rawText.match(/(?:^|\n|\.\s+)(why\s+(?:it|this)\s+fails?:?[\s\S]*)/i);
  if (splitMatch) {
    badPrompt = rawText.substring(0, splitMatch.index).trim();
    explanation = splitMatch[1].trim();
  } else {
    badPrompt = rawText;
  }

  // Clean bad prompt text: remove "Example:", "❌", and surrounding quotes
  badPrompt = badPrompt.replace(/^example\s*:\s*/i, '');
  badPrompt = badPrompt.replace(/^❌\s*/i, '');
  badPrompt = badPrompt.replace(/^['"“\s]+|['"”\s]+$/g, '').trim();

  let html = '';

  // 1. Red section: contains ONLY the bad prompt itself
  if (badPrompt) {
    html += `
      <div class="bad-prompt-callout">
        <div class="bad-prompt-tag">❌ AVOID THIS PROMPT</div>
        <div class="bad-prompt-text">"${escapeHtml(badPrompt)}"</div>
      </div>
    `;
  }

  // 2. Normal text section: explanation displayed below the red box
  if (explanation) {
    const headingMatch = explanation.match(/^(why\s+(?:it|this)\s+fails?:?)\s*([\s\S]*)/i);
    if (headingMatch) {
      const heading = headingMatch[1].replace(/:$/, '') + ':';
      const body = headingMatch[2].trim();
      const bodyLines = body.split(/\r?\n/).filter(l => l.trim().length > 0);

      html += `<div class="trap-explanation-normal">`;
      if (bodyLines.length > 0) {
        html += `<p><strong>${escapeHtml(heading)}</strong> ${escapeHtml(bodyLines[0])}</p>`;
        for (let i = 1; i < bodyLines.length; i++) {
          const line = bodyLines[i];
          if (/^[•\-\*]/.test(line)) {
            html += `<p style="padding-left: 10px;">• ${escapeHtml(line.replace(/^[•\-\*]\s*/, ''))}</p>`;
          } else {
            html += `<p>${escapeHtml(line)}</p>`;
          }
        }
      } else {
        html += `<p><strong>${escapeHtml(heading)}</strong></p>`;
      }
      html += `</div>`;
    } else {
      const lines = explanation.split(/\r?\n/).filter(l => l.trim().length > 0);
      html += `<div class="trap-explanation-normal">`;
      for (const line of lines) {
        html += `<p>${escapeHtml(line)}</p>`;
      }
      html += `</div>`;
    }
  }

  return html;
}

function renderHistory() {
  if (promptHistory.length === 0) {
    historyList.innerHTML = `<p style="color: var(--text-dim); text-align: center; padding: 20px;">No previous prompts yet.</p>`;
    return;
  }

  const reversed = [...promptHistory].reverse();
  historyList.innerHTML = reversed.map((p, idx) => `
    <div class="history-item-card">
      <div class="history-item-top">
        <span class="history-item-title">#${reversed.length - idx}: ${escapeHtml((p.title || '').replace(/^(?:module|prompt)\s*\d*\s*[:\-–—]\s*/i, '').trim())}</span>
        <button class="btn-copy-mini" onclick="copyHistoryItem('${p.id}', this)">Copy</button>
      </div>
      <div class="history-item-preview">${escapeHtml(p.content)}</div>
    </div>
  `).join('');
}

function showBroadcast(text) {
  broadcastMessage.textContent = text;
  broadcastBanner.classList.remove('hidden');
  if (audioAlertsEnabled) {
    playChime();
  }
}

// ---------------- CLIPBOARD ACTIONS ----------------

function handleCopyText(text, btnEl, iconEl, textEl) {
  copyToClipboard(text);

  if (btnEl) btnEl.classList.add('copied');
  if (iconEl) iconEl.textContent = '✅';
  if (textEl) textEl.textContent = 'COPIED!';

  showToast('✅ Copied prompt to clipboard!');

  if (navigator.vibrate) {
    navigator.vibrate([40]);
  }

  setTimeout(() => {
    if (btnEl) btnEl.classList.remove('copied');
    if (iconEl) iconEl.textContent = '📋';
    if (textEl) textEl.textContent = 'COPY PROMPT';
  }, 2000);
}

function copyHistoryItem(id, btnElement) {
  const p = promptHistory.find(x => x.id === id);
  if (p) {
    copyToClipboard(p.content);
    btnElement.classList.add('copied');
    btnElement.textContent = 'Copied!';
    showToast(`✅ Copied "${p.title}"!`);
    setTimeout(() => {
      btnElement.classList.remove('copied');
      btnElement.textContent = 'Copy';
    }, 1800);
  }
}
window.copyHistoryItem = copyHistoryItem;

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('Fallback copy failed', e);
    }
    document.body.removeChild(textarea);
  }
}

// ---------------- SOUND CHIME (WEB AUDIO API) ----------------

function playChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {}
}

// ---------------- UTILITIES ----------------

function showToast(msg) {
  participantToast.textContent = msg;
  participantToast.classList.remove('hidden');
  clearTimeout(participantToast._timer);
  participantToast._timer = setTimeout(() => {
    participantToast.classList.add('hidden');
  }, 2200);
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
