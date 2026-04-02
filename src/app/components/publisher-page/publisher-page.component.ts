import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PollingComponent } from '../../shared/polling.component';

export type RunMode = 'analysis' | 'scraping' | 'publisher_single' | 'publisher_batch';

export interface PublisherSettings {
  PROCESS_SINGLE_VIDEO: boolean;
  ENABLE_SCRAPING_MODE: boolean;
  ENABLE_ANALYSIS_MODE: boolean;
  VIDEOS_TO_PROCESS_COUNT: number;
  TEST_MODE: boolean;
}

interface ServiceStatus {
  id: string;
  status: 'online' | 'offline' | 'starting' | 'stopping' | 'unhealthy' | 'unknown';
  pid: number | null;
}

interface DataFileMeta {
  key: string;
  label: string;
  description: string;
  path: string;
  exists: boolean;
  size: number;
  modified: number | null;
}

// ── Exact JSON schemas from youtube_shorts_publisher ──────────────────────────

interface DraftAnalysisEntry {
  description: string;
  virality: number;
  virality_reasoning: string;
  game_name: string;
  is_fnaf_game: boolean;
  new_title: string;
  youtube_description: string;
  hashtags: string[];
  tags: string;
  title: string;        // original title
}

interface FailedShortsEntry {
  title: string;
  error: string;        // multiline — use white-space: pre-wrap
  timestamp: string;
}

interface DraftVideoEntry {
  title: string;
  has_backtrack: boolean;
}

interface BacktrackVideoEntry {
  title: string;
  has_backtrack: boolean;
  current_status: string;   // e.g. "Draft"
}

// ─────────────────────────────────────────────────────────────────────────────

const MODE_META: Record<RunMode, { label: string; icon: string; desc: string; color: string }> = {
  analysis:         { label: 'AI Analysis',  icon: '🤖', desc: 'Download drafts & analyze with Gemini',        color: '#a78bfa' },
  scraping:         { label: 'Scraper',       icon: '🕷',  desc: 'Scan & export draft/scheduled data to JSON',  color: '#fbbf24' },
  publisher_single: { label: 'Publish One',   icon: '▶',  desc: 'Process a single draft from analysis results', color: '#4ade80' },
  publisher_batch:  { label: 'Publish Batch', icon: '⚡', desc: 'Process multiple drafts up to the set limit',  color: '#f87171' },
};

function settingsToMode(s: PublisherSettings): RunMode {
  if (s.ENABLE_ANALYSIS_MODE) return 'analysis';
  if (s.ENABLE_SCRAPING_MODE) return 'scraping';
  if (s.PROCESS_SINGLE_VIDEO) return 'publisher_single';
  return 'publisher_batch';
}

function modeToFlags(mode: RunMode) {
  return {
    ENABLE_ANALYSIS_MODE: mode === 'analysis',
    ENABLE_SCRAPING_MODE: mode === 'scraping',
    PROCESS_SINGLE_VIDEO: mode === 'publisher_single',
  };
}

@Component({
  selector: 'app-publisher-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './publisher-page.component.html',
  styleUrl:    './publisher-page.component.scss',
})
export class PublisherPageComponent extends PollingComponent {
  protected override pollingInterval = 4000;

  readonly MODE_META = MODE_META;
  readonly modes: RunMode[] = ['analysis', 'scraping', 'publisher_single', 'publisher_batch'];
  readonly Math = Math;

  // ── Publisher controls ────────────────────────────────────────────────────
  selectedMode   = signal<RunMode>('publisher_batch');
  videoCount     = signal(50);
  testMode       = signal(false);
  serviceStatus  = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  saving         = signal(false);
  saveError      = signal('');
  saveDone       = signal(false);
  actionPending  = signal(false);
  loading        = signal(false);
  lastUpdated    = signal('—');
  settingsLoaded = signal(false);
  logs           = signal<string[]>([]);

  // ── Data viewer ───────────────────────────────────────────────────────────
  dataFiles       = signal<DataFileMeta[]>([]);
  dataViewState   = signal<'list' | 'file'>('list');
  selectedFile    = signal<DataFileMeta | null>(null);
  selectedContent = signal<any>(null);
  dataLoading     = signal(false);

  // ── Clear modal ───────────────────────────────────────────────────────────
  showClearModal = signal(false);
  clearing       = signal(false);

  // ── Computed ──────────────────────────────────────────────────────────────
  isRunning  = computed(() => this.serviceStatus()?.status === 'online');
  isStarting = computed(() => this.serviceStatus()?.status === 'starting');
  isStopping = computed(() => this.serviceStatus()?.status === 'stopping');
  showVideoCount = computed(() => this.selectedMode() === 'publisher_batch');
  showTestMode   = computed(() =>
    this.selectedMode() === 'publisher_single' || this.selectedMode() === 'publisher_batch'
  );

  statusMeta = computed(() => {
    const s = this.serviceStatus()?.status ?? 'unknown';
    const map: Record<string, { label: string; color: string; icon: string }> = {
      online:    { label: 'Running',   color: '#22c55e', icon: '●' },
      offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
      starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
      stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
      unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
      unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
    };
    return map[s] ?? map['unknown'];
  });

  // ── Typed content casts ───────────────────────────────────────────────────
  asDraftAnalysis(): DraftAnalysisEntry[]   { return Array.isArray(this.selectedContent()) ? this.selectedContent() : []; }
  asFailedShorts():  FailedShortsEntry[]    { return Array.isArray(this.selectedContent()) ? this.selectedContent() : []; }
  asDraftVideos():   DraftVideoEntry[]      { return Array.isArray(this.selectedContent()) ? this.selectedContent() : []; }
  asBacktrack():     BacktrackVideoEntry[]  { return Array.isArray(this.selectedContent()) ? this.selectedContent() : []; }

  // ── Helpers ───────────────────────────────────────────────────────────────
  viralityColor(score: number): string {
    if (score >= 8) return '#34d399';
    if (score >= 6) return '#fbbf24';
    return '#f87171';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  formatDate(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  isErr  = (l: string) => /error|failed|exception|traceback|fatal/i.test(l);
  isOk   = (l: string) => /✅|healthy|ready|started|running/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  // ── Polling ───────────────────────────────────────────────────────────────
  override async poll() {
    this.loading.set(true);
    try {
      const [svcRes, settingsRes] = await Promise.all([
        fetch('/launcher/services'),
        this.settingsLoaded() ? Promise.resolve(null) : fetch('/launcher/publisher/settings'),
      ]);

      if (svcRes.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await svcRes.json();
        this.serviceStatus.set(svcs.find(s => s.id === 'youtube_publisher') ?? null);
        this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
      } else {
        this.launcherOnline.set(false);
      }

      if (settingsRes?.ok) {
        const s: PublisherSettings = await settingsRes.json();
        this.selectedMode.set(settingsToMode(s));
        this.videoCount.set(s.VIDEOS_TO_PROCESS_COUNT);
        this.testMode.set(s.TEST_MODE);
        this.settingsLoaded.set(true);
      }
    } catch {
      this.launcherOnline.set(false);
      this.lastUpdated.set('Launcher offline');
    } finally {
      this.loading.set(false);
    }

    await this.refreshLogs();
    if (this.dataViewState() === 'list') await this.refreshDataFiles();
  }

  // ── Data viewer ───────────────────────────────────────────────────────────
  async refreshDataFiles() {
    const res = await fetch('/launcher/publisher/data/files').catch(() => null);
    if (res?.ok) this.dataFiles.set(await res.json());
  }

  async openDataFile(file: DataFileMeta) {
    if (!file.exists) return;
    this.selectedFile.set(file);
    this.dataViewState.set('file');
    this.dataLoading.set(true);
    this.selectedContent.set(null);
    const res = await fetch(`/launcher/publisher/data/file?key=${file.key}`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.selectedContent.set(d.data);
    }
    this.dataLoading.set(false);
  }

  backToDataList() {
    this.dataViewState.set('list');
    this.selectedFile.set(null);
    this.selectedContent.set(null);
    this.refreshDataFiles();
  }

  // ── Clear modal ───────────────────────────────────────────────────────────
  openClearModal() { this.showClearModal.set(true); }
  cancelClear()    { this.showClearModal.set(false); }

  async confirmClear() {
    const key = this.selectedFile()?.key;
    if (!key) return;
    this.clearing.set(true);
    try {
      const res = await fetch(`/launcher/publisher/data/file?key=${key}`, { method: 'DELETE' });
      if (res.ok) {
        this.showClearModal.set(false);
        this.backToDataList();
      }
    } finally {
      this.clearing.set(false);
    }
  }

  // ── Publisher controls ────────────────────────────────────────────────────
  selectMode(mode: RunMode) { this.selectedMode.set(mode); }

  async saveSettings() {
    this.saving.set(true);
    this.saveError.set('');
    this.saveDone.set(false);
    const payload: PublisherSettings = {
      ...modeToFlags(this.selectedMode()),
      VIDEOS_TO_PROCESS_COUNT: this.videoCount(),
      TEST_MODE: this.testMode(),
    };
    try {
      const res = await fetch('/launcher/publisher/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.saveDone.set(true);
      setTimeout(() => this.saveDone.set(false), 2000);
    } catch (e: any) {
      this.saveError.set(e?.message ?? 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }

  async saveAndRun() {
    await this.saveSettings();
    if (this.saveError()) return;
    await this.serviceAction('start');
  }

  async serviceAction(act: 'start' | 'stop' | 'restart') {
    if (!this.launcherOnline() || this.actionPending()) return;
    this.actionPending.set(true);
    try {
      await fetch(`/launcher/services/youtube_publisher/${act}`, { method: 'POST' });
      await this.poll();
      if (act !== 'stop') setTimeout(() => this.poll(), 2500);
    } finally {
      this.actionPending.set(false);
    }
  }

  async refreshLogs() {
    if (!this.launcherOnline()) return;
    const res = await fetch('/launcher/services/youtube_publisher/logs?last=200').catch(() => null);
    if (res?.ok) { const d = await res.json(); this.logs.set(d.lines ?? []); }
  }

  async clearLogs() {
    await fetch('/launcher/services/youtube_publisher/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }
}