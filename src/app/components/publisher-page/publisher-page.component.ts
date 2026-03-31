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

const MODE_META: Record<RunMode, { label: string; icon: string; desc: string; color: string }> = {
  analysis: {
    label: 'AI Analysis',
    icon: '🤖',
    desc: 'Download drafts & analyze with Gemini',
    color: '#a78bfa',
  },
  scraping: {
    label: 'Scraper',
    icon: '🕷',
    desc: 'Scan & export draft/scheduled data to JSON',
    color: '#fbbf24',
  },
  publisher_single: {
    label: 'Publish One',
    icon: '▶',
    desc: 'Process a single draft from analysis results',
    color: '#4ade80',
  },
  publisher_batch: {
    label: 'Publish Batch',
    icon: '⚡',
    desc: 'Process multiple drafts up to the set limit',
    color: '#f87171',
  },
};

function settingsToMode(s: PublisherSettings): RunMode {
  if (s.ENABLE_ANALYSIS_MODE) return 'analysis';
  if (s.ENABLE_SCRAPING_MODE) return 'scraping';
  if (s.PROCESS_SINGLE_VIDEO) return 'publisher_single';
  return 'publisher_batch';
}

function modeToFlags(mode: RunMode): Pick<
  PublisherSettings,
  'ENABLE_ANALYSIS_MODE' | 'ENABLE_SCRAPING_MODE' | 'PROCESS_SINGLE_VIDEO'
> {
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
  styleUrl: './publisher-page.component.scss',
})
export class PublisherPageComponent extends PollingComponent {
  protected override pollingInterval = 4000;

  readonly MODE_META = MODE_META;
  readonly modes: RunMode[] = ['analysis', 'scraping', 'publisher_single', 'publisher_batch'];
  readonly Math = Math;

  // ── State ──────────────────────────────────────────────────────────────────
  selectedMode  = signal<RunMode>('publisher_batch');
  videoCount    = signal(50);
  testMode      = signal(false);
  serviceStatus = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  saving        = signal(false);
  saveError     = signal('');
  saveDone      = signal(false);
  actionPending = signal(false);
  loading       = signal(false);
  lastUpdated   = signal('—');
  settingsLoaded = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────────
  isRunning = computed(() => this.serviceStatus()?.status === 'online');
  isStarting = computed(() => this.serviceStatus()?.status === 'starting');
  isStopping = computed(() => this.serviceStatus()?.status === 'stopping');
  showVideoCount = computed(() => this.selectedMode() === 'publisher_batch');
  showTestMode = computed(() =>
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

  // ── Init ───────────────────────────────────────────────────────────────────
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
        const pub = svcs.find(s => s.id === 'youtube_publisher') ?? null;
        this.serviceStatus.set(pub);
        this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
      } else {
        this.launcherOnline.set(false);
      }

      if (settingsRes && settingsRes.ok) {
        const settings: PublisherSettings = await settingsRes.json();
        this.selectedMode.set(settingsToMode(settings));
        this.videoCount.set(settings.VIDEOS_TO_PROCESS_COUNT);
        this.testMode.set(settings.TEST_MODE);
        this.settingsLoaded.set(true);
      }
    } catch {
      this.launcherOnline.set(false);
      this.lastUpdated.set('Launcher offline');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  selectMode(mode: RunMode) {
    this.selectedMode.set(mode);
  }

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
}