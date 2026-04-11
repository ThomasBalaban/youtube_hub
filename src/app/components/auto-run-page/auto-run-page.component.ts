import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PollingComponent } from '../../shared/polling.component';

interface PipelineStatus {
  running: boolean;
  step: 'idle' | 'scanning' | 'processing' | 'uploading' | 'checking' | 'scraping' | 'analyzing' | 'publishing' | 'waiting' | 'error';
  step_label: string;
  next_scan_in: number | null;  // seconds
  last_run_at: string | null;
  last_run_files: number;
  errors: string[];
  history_count: number;
}

interface RunRecord {
  timestamp: string;
  files_in_inventory: number;
  files_processed: number;
  errors: string[];
  duration_s: number;
}

@Component({
  selector: 'app-auto-run-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './auto-run-page.component.html',
  styleUrl: './auto-run-page.component.scss',
})
export class AutoRunPageComponent extends PollingComponent {
  protected override pollingInterval = 3000;

  // ── State ──────────────────────────────────────────────────────────────────
  status        = signal<PipelineStatus | null>(null);
  launcherOnline = signal(false);
  logs          = signal<string[]>([]);
  runs          = signal<RunRecord[]>([]);
  lastUpdated   = signal('—');
  actionPending = signal(false);

  // ── Settings ───────────────────────────────────────────────────────────────
  destDir       = signal('');
  destDirLoaded = signal(false);
  saving        = signal(false);
  saveDone      = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────────
  isRunning  = computed(() => this.status()?.running ?? false);
  currentStep = computed(() => this.status()?.step ?? 'idle');
  errors     = computed(() => this.status()?.errors ?? []);

  stepMeta = computed(() => {
    const step = this.currentStep();
    const map: Record<string, { label: string; color: string; icon: string }> = {
      idle:       { label: 'Idle',       color: '#4b5563', icon: '○' },
      scanning:   { label: 'Scanning',   color: '#fbbf24', icon: '◌' },
      processing: { label: 'Processing', color: '#60a5fa', icon: '◌' },
      uploading:  { label: 'Uploading',  color: '#f97316', icon: '◌' },
      checking:   { label: 'Cleaning up',color: '#06b6d4', icon: '◌' },
      scraping:   { label: 'Scraping',   color: '#fbbf24', icon: '◌' },
      analyzing:  { label: 'Analyzing',  color: '#a78bfa', icon: '◌' },
      publishing: { label: 'Publishing', color: '#34d399', icon: '◌' },
      waiting:    { label: 'Waiting',    color: '#a855f7', icon: '◌' },
      error:      { label: 'Error',      color: '#ef4444', icon: '⚠' },
    };
    return map[step] ?? map['idle'];
  });

  nextScanLabel = computed(() => {
    const sec = this.status()?.next_scan_in;
    if (sec == null) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  });

  steps = [
    { id: 'scanning',   label: 'Backtrack Scan',    icon: '🔍' },
    { id: 'processing', label: 'SimpleAutoSubs',     icon: '💬' },
    { id: 'uploading',  label: 'YouTube Uploader',   icon: '▶'  },
    { id: 'checking',   label: 'Check & Cleanup',    icon: '🗑'  },
    { id: 'scraping',   label: 'Scraper',            icon: '🕷'  },
    { id: 'analyzing',  label: 'AI Analysis',        icon: '🤖' },
    { id: 'publishing', label: 'Publish Batch',      icon: '📤' },
  ];

  // Step order for marking prior steps as done
  private readonly _stepOrder = ['scanning', 'processing', 'uploading', 'checking', 'scraping', 'analyzing', 'publishing', 'waiting'];

  stepStatus(id: string): 'active' | 'done' | 'waiting' | 'idle' {
    const step = this.currentStep();
    const running = this.isRunning();
    if (!running) return 'idle';
    if (step === id) return 'active';
    const currentIdx = this._stepOrder.indexOf(step);
    const thisIdx    = this._stepOrder.indexOf(id);
    if (thisIdx < currentIdx) return 'done';
    return 'waiting';
  }

  // ── Log helpers ────────────────────────────────────────────────────────────
  isErr  = (l: string) => /error|failed|exception|❌/i.test(l);
  isOk   = (l: string) => /✅|complete|done|success/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);
  isStep = (l: string) => /^.*(STEP \d|═{5}|─{5}|🚀)/i.test(l);

  // ── Polling ────────────────────────────────────────────────────────────────
  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      this.launcherOnline.set(res.ok);
    } catch {
      this.launcherOnline.set(false);
    }

    if (!this.launcherOnline()) {
      this.lastUpdated.set('Launcher offline');
      return;
    }

    const [statusRes, logsRes, runsRes] = await Promise.allSettled([
      fetch('/launcher/pipeline/status'),
      fetch('/launcher/pipeline/logs?last=400'),
      fetch('/launcher/pipeline/runs'),
    ]);

    if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
      this.status.set(await statusRes.value.json());
    }
    if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
      const d = await logsRes.value.json();
      this.logs.set(d.lines ?? []);
    }
    if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
      const d = await runsRes.value.json();
      this.runs.set(d.runs ?? []);
    }

    if (!this.destDirLoaded()) {
      const r = await fetch('/launcher/pipeline/settings').catch(() => null);
      if (r?.ok) {
        const d = await r.json();
        this.destDir.set(d.backtrack_dest_dir ?? '');
        this.destDirLoaded.set(true);
      }
    }

    this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async togglePipeline() {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    const endpoint = this.isRunning() ? '/launcher/pipeline/stop' : '/launcher/pipeline/start';
    try {
      await fetch(endpoint, { method: 'POST' });
      await this.poll();
    } finally {
      this.actionPending.set(false);
    }
  }

  async saveSettings() {
    this.saving.set(true);
    this.saveDone.set(false);
    try {
      await fetch('/launcher/pipeline/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backtrack_dest_dir: this.destDir() }),
      });
      this.saveDone.set(true);
      setTimeout(() => this.saveDone.set(false), 2000);
    } finally {
      this.saving.set(false);
    }
  }

  async clearLogs() {
    await fetch('/launcher/pipeline/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  formatDuration(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
}