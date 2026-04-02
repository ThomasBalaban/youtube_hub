import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PollingComponent } from '../../shared/polling.component';

interface FileEntry {
  input_path: string;
  output_path: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  title: string;
  error: string;
}

interface ProcessStatus {
  processing: boolean;
  stop_requested: boolean;
  current_index: number;
  total: number;
  queued: number;
  done: number;
  errors: number;
}

interface SubtitlerSettings {
  animation_type: string;
  sync_offset: number;
  output_dir: string;
  enable_trimming: boolean;
}

interface ServiceStatus {
  id: string;
  status: string;
  pid: number | null;
}

const ANIMATION_TYPES = [
  'Auto', 'Drift & Fade', 'Wiggle', 'Pop & Shrink',
  'Shake', 'Pulse', 'Wave', 'Explode-Out', 'Hyper Bounce', 'Static',
];

@Component({
  selector: 'app-subtitler-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './subtitler-page.component.html',
  styleUrl:    './subtitler-page.component.scss',
})
export class SubtitlerPageComponent extends PollingComponent {
  protected override pollingInterval = 3000;

  readonly animationTypes = ANIMATION_TYPES;
  readonly Math = Math;

  // ── State ──────────────────────────────────────────────────────────────────
  files          = signal<FileEntry[]>([]);
  processStatus  = signal<ProcessStatus | null>(null);
  settings       = signal<SubtitlerSettings>({
    animation_type: 'Auto',
    sync_offset:    -0.15,
    output_dir:     '',
    enable_trimming: true,
  });
  serviceStatus  = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  apiOnline      = signal(false);
  logs           = signal<string[]>([]);
  lastUpdated    = signal('—');
  saving         = signal(false);
  saveDone       = signal(false);
  saveError      = signal('');
  actionPending  = signal(false);
  settingsLoaded = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────────
  isProcessing    = computed(() => this.processStatus()?.processing ?? false);
  isStopRequested = computed(() => this.processStatus()?.stop_requested ?? false);

  progressValue = computed(() => {
    const st = this.processStatus();
    if (!st || st.total === 0) return 0;
    return (st.done + st.errors) / st.total;
  });

  serviceStatusMeta = computed(() => {
    const s = this.serviceStatus()?.status ?? 'unknown';
    const map: Record<string, { label: string; color: string; icon: string }> = {
      online:    { label: 'Running',   color: '#34d399', icon: '●' },
      offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
      starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
      stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
      unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
      unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
    };
    return map[s] ?? map['unknown'];
  });

  // ── Settings setters (templates can't use arrow functions) ────────────────
  setAnimationType(v: string)   { this.settings.update(s => ({ ...s, animation_type: v })); }
  setSyncOffset(v: number)      { this.settings.update(s => ({ ...s, sync_offset: +v })); }
  setOutputDir(v: string)       { this.settings.update(s => ({ ...s, output_dir: v })); }
  setEnableTrimming(v: boolean) { this.settings.update(s => ({ ...s, enable_trimming: v })); }
  toggleTrimming()              { this.settings.update(s => ({ ...s, enable_trimming: !s.enable_trimming })); }

  // ── Log helpers ────────────────────────────────────────────────────────────
  isErr  = (l: string) => /error|failed|exception|traceback|fatal|❌/i.test(l);
  isOk   = (l: string) => /✅|success|done|complete/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  // ── File display helpers ───────────────────────────────────────────────────
  fileIcon(status: string): string {
    return { queued: '○', processing: '◌', done: '✓', error: '✗' }[status] ?? '?';
  }

  fileColor(status: string): string {
    return {
      queued:     '#6b7280',
      processing: '#3b82f6',
      done:       '#34d399',
      error:      '#ef4444',
    }[status] ?? '#6b7280';
  }

  basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  // ── Polling ────────────────────────────────────────────────────────────────
  override async poll() {
    // 1. Launcher status (always)
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await res.json();
        const svc = svcs.find(s => s.id === 'simple_auto_subs_api') ?? null;
        this.serviceStatus.set(svc);
        this.apiOnline.set(svc?.status === 'online');
      } else {
        this.launcherOnline.set(false);
        this.apiOnline.set(false);
      }
    } catch {
      this.launcherOnline.set(false);
      this.apiOnline.set(false);
    }

    // 2. API data — only when API is online
    if (!this.apiOnline()) {
      this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
      return;
    }

    const [statusRes, filesRes, logsRes] = await Promise.allSettled([
      fetch('/subtitler/process/status'),
      fetch('/subtitler/files'),
      fetch('/subtitler/logs?last=200'),
    ]);

    if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
      this.processStatus.set(await statusRes.value.json());
    }
    if (filesRes.status === 'fulfilled' && filesRes.value.ok) {
      this.files.set(await filesRes.value.json());
    }
    if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
      const data = await logsRes.value.json();
      this.logs.set(data.lines ?? []);
    }

    // Load settings once
    if (!this.settingsLoaded()) {
      try {
        const res = await fetch('/subtitler/settings');
        if (res.ok) {
          this.settings.set(await res.json());
          this.settingsLoaded.set(true);
        }
      } catch { /* silent */ }
    }

    this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
  }

  // ── File actions ───────────────────────────────────────────────────────────
  async browseFiles() {
    try {
      const res = await fetch('/subtitler/files/browse');
      if (!res.ok) return;
      const { paths } = await res.json();
      if (!paths?.length) return;
      await fetch('/subtitler/files', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ paths }),
      });
      await this._refreshFiles();
    } catch (e) {
      console.error('Browse failed:', e);
    }
  }

  async removeFile(index: number, event: MouseEvent) {
    event.stopPropagation();
    await fetch(`/subtitler/files/${index}`, { method: 'DELETE' }).catch(() => {});
    await this._refreshFiles();
  }

  async clearFiles() {
    await fetch('/subtitler/files', { method: 'DELETE' }).catch(() => {});
    await this._refreshFiles();
  }

  async resetFiles() {
    await fetch('/subtitler/files/reset', { method: 'POST' }).catch(() => {});
    await this._refreshFiles();
  }

  private async _refreshFiles() {
    const res = await fetch('/subtitler/files').catch(() => null);
    if (res?.ok) this.files.set(await res.json());
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async browseOutputDir() {
    try {
      const res = await fetch('/subtitler/settings/browse-dir');
      if (!res.ok) return;
      const { path } = await res.json();
      if (path) this.settings.update(s => ({ ...s, output_dir: path }));
    } catch { /* silent */ }
  }

  async saveSettings() {
    this.saving.set(true);
    this.saveError.set('');
    this.saveDone.set(false);
    try {
      const res = await fetch('/subtitler/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(this.settings()),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.saveDone.set(true);
      setTimeout(() => this.saveDone.set(false), 2000);
      await this._refreshFiles(); // output paths may have changed
    } catch (e: any) {
      this.saveError.set(e?.message ?? 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Service control (via launcher) ─────────────────────────────────────────
  async serviceAction(act: 'start' | 'stop' | 'restart') {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    try {
      await fetch(`/launcher/services/simple_auto_subs_api/${act}`, { method: 'POST' });
      await this.poll();
      if (act !== 'stop') setTimeout(() => this.poll(), 3000);
    } finally {
      this.actionPending.set(false);
    }
  }

  // ── Processing control (via subtitler API) ─────────────────────────────────
  async startProcessing() {
    await fetch('/subtitler/process/start', { method: 'POST' }).catch(() => {});
    await this.poll();
  }

  async stopProcessing() {
    await fetch('/subtitler/process/stop', { method: 'POST' }).catch(() => {});
    await this.poll();
  }

  // ── Logs ───────────────────────────────────────────────────────────────────
  async clearLogs() {
    await fetch('/subtitler/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }
}