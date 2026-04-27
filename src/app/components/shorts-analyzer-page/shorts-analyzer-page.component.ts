import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PollingComponent } from '../../shared/polling.component';

interface ServiceStatus { id: string; status: string; pid: number | null; }

interface ResultFile {
  name: string;
  path: string;
  modified: number;
  size: number;
}

type FileKind = 'main' | 'synthesis' | 'tailwind' | 'context' | 'other';

type StaleReason = 'missing' | 'schema_mismatch' | 'model_mismatch' | 'prompt_mismatch';

interface VideoPhaseState {
  present: boolean;
  stale_reasons: StaleReason[];
}

interface VideoRow {
  video_id: string;
  title: string;
  views: number;
  published_date: string;
  breakout_score: number | null;
  phases: {
    analytics: VideoPhaseState & { avg_view_percentage: number | null; fetched_at: string | null };
    analysis:  VideoPhaseState & { ran_at: string | null };
    tailwind:  VideoPhaseState;
  };
}

interface VideosResponse {
  channel_url: string;
  corpus_schema_version: number;
  videos: VideoRow[];
}

interface JobStatus {
  running: boolean;
  stop_requested: boolean;
  current_job: {
    kind: string;
    started_at: number;
    output?: string;
    video_ids?: string[] | null;
    filter?: string | null;
    channel_url?: string;
    max_shorts?: number;
  } | null;
  last_error: string | null;
  last_result: Record<string, unknown> | null;
  progress: {
    phase: string;
    current: number;
    total: number;
    current_title: string;
  };
}

type AnalysisFilter = 'missing' | 'schema_mismatch' | 'model_mismatch' | 'prompt_mismatch';
type AnalyticsFilter = 'missing';
type TailwindFilter = 'missing' | 'schema_mismatch' | 'model_mismatch' | 'prompt_mismatch';

type ViewState = 'list' | 'videos' | 'raw';

@Component({
  selector: 'app-shorts-analyzer-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './shorts-analyzer-page.component.html',
  styleUrl: './shorts-analyzer-page.component.scss',
})
export class ShortsAnalyzerPageComponent extends PollingComponent {
  protected override pollingInterval = 2000;

  // ── Core state ─────────────────────────────────────────────────────────────
  serviceStatus  = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  apiOnline      = signal(false);
  actionPending  = signal(false);
  logs           = signal<string[]>([]);
  lastUpdated    = signal('—');

  jobStatus = signal<JobStatus | null>(null);

  // Start-analysis form
  readonly channelUrl = 'https://www.youtube.com/@PeepingOtter/shorts';
  maxShorts     = signal(100);
  startingJob   = signal(false);
  formError     = signal('');

  // File + video viewer state
  files           = signal<ResultFile[]>([]);
  viewState       = signal<ViewState>('list');
  selectedFile    = signal<ResultFile | null>(null);
  videosResponse  = signal<VideosResponse | null>(null);
  rawJson         = signal<unknown>(null);
  loadingFile     = signal(false);
  selectedIds     = signal<Set<string>>(new Set());

  // Rerun options (per-request flags)
  tailwindIncludeAll       = signal(false);
  tailwindUseTrends        = signal(false);
  synthesisSkipNarrative   = signal(false);

  // Confirm modals
  showDeleteModal    = signal(false);
  deleting           = signal(false);
  showFullRerunModal = signal(false);   // "rerun analysis for every video" is expensive

  // ── Computed ───────────────────────────────────────────────────────────────
  isRunning  = computed(() => this.serviceStatus()?.status === 'online');
  isStarting = computed(() => this.serviceStatus()?.status === 'starting');
  jobRunning = computed(() => !!this.jobStatus()?.running);

  statusMeta = computed(() => {
    const s = this.serviceStatus()?.status ?? 'unknown';
    const map: Record<string, { label: string; color: string; icon: string }> = {
      online:    { label: 'Running',   color: '#38bdf8', icon: '●' },
      offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
      starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
      stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
      unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
      unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
    };
    return map[s] ?? map['unknown'];
  });

  progressValue = computed(() => {
    const st = this.jobStatus();
    if (!st || st.progress.total === 0) return 0;
    return st.progress.current / st.progress.total;
  });

  // Counts of videos in each stale bucket — drives the rerun toolbar labels
  staleCounts = computed(() => {
    const videos = this.videosResponse()?.videos ?? [];
    const counts = {
      analytics_missing: 0,
      analysis_missing: 0,
      analysis_schema_mismatch: 0,
      analysis_model_mismatch: 0,
      analysis_prompt_mismatch: 0,
      tailwind_missing: 0,
      tailwind_schema_mismatch: 0,
      tailwind_model_mismatch: 0,
      tailwind_prompt_mismatch: 0,
      total: videos.length,
    };
    for (const v of videos) {
      if (!v.phases.analytics.present) counts.analytics_missing++;
      if (!v.phases.analysis.present) counts.analysis_missing++;
      for (const r of v.phases.analysis.stale_reasons) {
        if (r === 'schema_mismatch') counts.analysis_schema_mismatch++;
        else if (r === 'model_mismatch') counts.analysis_model_mismatch++;
        else if (r === 'prompt_mismatch') counts.analysis_prompt_mismatch++;
      }
      if (!v.phases.tailwind.present) counts.tailwind_missing++;
      for (const r of v.phases.tailwind.stale_reasons) {
        if (r === 'schema_mismatch') counts.tailwind_schema_mismatch++;
        else if (r === 'model_mismatch') counts.tailwind_model_mismatch++;
        else if (r === 'prompt_mismatch') counts.tailwind_prompt_mismatch++;
      }
    }
    return counts;
  });

  selectedCount = computed(() => this.selectedIds().size);

  // Group files by base handle so sibling files (.synthesis/.tailwind/.context) live under the main corpus file.
  groupedFiles = computed(() => {
    const groups = new Map<string, { main: ResultFile | null; siblings: Array<{ file: ResultFile; kind: FileKind }> }>();
    const byName = (f: ResultFile) => ({ file: f, kind: this.fileKind(f.name) });
    for (const f of this.files()) {
      const { kind } = byName(f);
      const base = this.baseHandle(f.name);
      if (!groups.has(base)) groups.set(base, { main: null, siblings: [] });
      const g = groups.get(base)!;
      if (kind === 'main') g.main = f;
      else g.siblings.push({ file: f, kind });
    }
    return Array.from(groups.entries())
      .map(([base, g]) => ({ base, ...g }))
      .sort((a, b) => {
        const aTime = a.main?.modified ?? Math.max(...a.siblings.map(s => s.file.modified), 0);
        const bTime = b.main?.modified ?? Math.max(...b.siblings.map(s => s.file.modified), 0);
        return bTime - aTime;
      });
  });

  fileKind(name: string): FileKind {
    if (name.endsWith('.synthesis.json')) return 'synthesis';
    if (name.endsWith('.tailwind.json'))  return 'tailwind';
    if (name.endsWith('.context.json'))   return 'context';
    if (name.endsWith('.json'))           return 'main';
    return 'other';
  }

  baseHandle(name: string): string {
    return name
      .replace(/\.synthesis\.json$/, '')
      .replace(/\.tailwind\.json$/, '')
      .replace(/\.context\.json$/, '')
      .replace(/\.json$/, '');
  }

  isErr  = (l: string) => /error|failed|exception|traceback|fatal|❌/i.test(l);
  isOk   = (l: string) => /✅|success|done|complete/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  // ── Polling ────────────────────────────────────────────────────────────────
  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await res.json();
        const svc = svcs.find(s => s.id === 'shorts_analyzer_api') ?? null;
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

    if (this.apiOnline()) {
      const [statusRes, logsRes] = await Promise.allSettled([
        fetch('/shorts-analyzer/analyze/status'),
        fetch('/shorts-analyzer/logs?last=300'),
      ]);
      if (statusRes.status === 'fulfilled' && statusRes.value.ok)
        this.jobStatus.set(await statusRes.value.json());
      if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
        const d = await logsRes.value.json();
        this.logs.set(d.lines ?? []);
      }

      if (this.viewState() === 'list') {
        await this.refreshFiles();
        // Auto-open the most-recent corpus file on first successful poll —
        // PeepingOtter is the only channel, so the rerun toolbar should be
        // visible by default rather than hidden behind a click.
        if (!this._autoOpened) {
          const groups = this.groupedFiles();
          const mainFile = groups.find(g => g.main)?.main;
          if (mainFile) {
            this._autoOpened = true;
            await this.openFile(mainFile);
          }
        }
      } else if (!this.jobRunning() && this._prevRunning) {
        // Auto-refresh the open view after a rerun completes
        const f = this.selectedFile();
        if (f) {
          if (this.viewState() === 'videos') await this.loadVideos(f);
          else if (this.viewState() === 'raw') await this.loadRaw(f);
        }
        await this.refreshFiles();
      }
      this._prevRunning = this.jobRunning();
    }

    this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
  }

  private _prevRunning = false;
  private _autoOpened  = false;

  // ── Service control ────────────────────────────────────────────────────────
  async serviceAction(act: 'start' | 'stop' | 'restart') {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    try {
      await fetch(`/launcher/services/shorts_analyzer_api/${act}`, { method: 'POST' });
      await this.poll();
      if (act !== 'stop') setTimeout(() => this.poll(), 3000);
    } finally { this.actionPending.set(false); }
  }

  // ── Files list ─────────────────────────────────────────────────────────────
  async refreshFiles() {
    if (!this.apiOnline()) { this.files.set([]); return; }
    const res = await fetch('/shorts-analyzer/results').catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.files.set(d.files ?? []);
    }
  }

  async openFile(file: ResultFile) {
    this.selectedFile.set(file);
    this.selectedIds.set(new Set());
    const kind = this.fileKind(file.name);
    if (kind === 'main') {
      this.viewState.set('videos');
      await this.loadVideos(file);
    } else {
      this.viewState.set('raw');
      await this.loadRaw(file);
    }
  }

  async loadVideos(file: ResultFile) {
    this.loadingFile.set(true);
    this.videosResponse.set(null);
    const res = await fetch(`/shorts-analyzer/videos?output=${encodeURIComponent(file.name)}`).catch(() => null);
    if (res?.ok) this.videosResponse.set(await res.json());
    this.loadingFile.set(false);
  }

  async loadRaw(file: ResultFile) {
    this.loadingFile.set(true);
    this.rawJson.set(null);
    const res = await fetch(`/shorts-analyzer/results/read?name=${encodeURIComponent(file.name)}`).catch(() => null);
    if (res?.ok) this.rawJson.set(await res.json());
    this.loadingFile.set(false);
  }

  downloadFile(file: ResultFile) {
    window.open(`/shorts-analyzer/results/download?name=${encodeURIComponent(file.name)}`, '_blank');
  }

  backToFiles() {
    this.viewState.set('list');
    this.selectedFile.set(null);
    this.videosResponse.set(null);
    this.rawJson.set(null);
    this.selectedIds.set(new Set());
    this._autoOpened = true;   // user chose the file list; don't auto-bounce them out of it
    this.refreshFiles();
  }

  prettyJson = computed(() => {
    const v = this.rawJson();
    if (v == null) return '';
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  });

  // ── Start new analysis ─────────────────────────────────────────────────────
  async startAnalysis() {
    if (this.jobRunning()) { this.formError.set('A job is already running'); return; }
    this.formError.set('');
    this.startingJob.set(true);
    try {
      const res = await fetch('/shorts-analyzer/analyze/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_url: this.channelUrl, max_shorts: this.maxShorts() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        this.formError.set(d.detail ?? `HTTP ${res.status}`);
      } else {
        await this.poll();
      }
    } catch (e: any) {
      this.formError.set(e?.message ?? 'Failed to start');
    } finally {
      this.startingJob.set(false);
    }
  }

  async stopJob() {
    await fetch('/shorts-analyzer/analyze/stop', { method: 'POST' }).catch(() => {});
    await this.poll();
  }

  // ── Reruns ─────────────────────────────────────────────────────────────────
  toggleSelect(videoId: string) {
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  clearSelection() { this.selectedIds.set(new Set()); }

  selectAllStale(phase: 'analysis' | 'tailwind') {
    const videos = this.videosResponse()?.videos ?? [];
    const next = new Set<string>();
    for (const v of videos) {
      if (v.phases[phase].stale_reasons.length > 0) next.add(v.video_id);
    }
    this.selectedIds.set(next);
  }

  private _fileName(): string | null {
    return this.selectedFile()?.name ?? null;
  }

  private async _postRerun(
    endpoint: 'analytics' | 'analysis' | 'synthesis' | 'tailwind',
    body: Record<string, unknown>,
  ) {
    if (!this.apiOnline() || this.jobRunning()) return;
    const res = await fetch(`/shorts-analyzer/rerun/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && !res.ok) {
      const d = await res.json().catch(() => ({}));
      this.formError.set(d.detail ?? `HTTP ${res.status}`);
    } else {
      this.formError.set('');
    }
    await this.poll();
  }

  // Analytics — supports `missing` and explicit ids
  async rerunAnalyticsMissing() {
    const name = this._fileName(); if (!name) return;
    await this._postRerun('analytics', { output: name, filter: 'missing' });
  }

  async rerunAnalyticsSelected() {
    const name = this._fileName(); if (!name) return;
    const ids = Array.from(this.selectedIds());
    if (!ids.length) return;
    await this._postRerun('analytics', { output: name, video_ids: ids });
  }

  // Analysis — full filter set + explicit ids. `filter: "all"` is refused by the API.
  async rerunAnalysisFilter(filter: AnalysisFilter) {
    const name = this._fileName(); if (!name) return;
    await this._postRerun('analysis', { output: name, filter });
  }

  async rerunAnalysisSelected() {
    const name = this._fileName(); if (!name) return;
    const ids = Array.from(this.selectedIds());
    if (!ids.length) return;
    await this._postRerun('analysis', { output: name, video_ids: ids });
  }

  openFullRerunModal()  { this.showFullRerunModal.set(true); }
  cancelFullRerun()     { this.showFullRerunModal.set(false); }

  // Full corpus rerun uses explicit video_ids because the API refuses `filter: "all"`
  async confirmFullRerun() {
    const name = this._fileName(); if (!name) return;
    const ids = (this.videosResponse()?.videos ?? []).map(v => v.video_id);
    if (!ids.length) { this.showFullRerunModal.set(false); return; }
    this.showFullRerunModal.set(false);
    await this._postRerun('analysis', { output: name, video_ids: ids });
  }

  // Synthesis — corpus-wide, `skip_narrative` toggle
  async rerunSynthesis() {
    const name = this._fileName(); if (!name) return;
    await this._postRerun('synthesis', {
      output: name,
      skip_narrative: this.synthesisSkipNarrative(),
    });
  }

  // Tailwind — filters, explicit ids, default sweep, plus `include_all` and `use_trends` flags
  private _tailwindBase(): Record<string, unknown> {
    return {
      output: this._fileName(),
      include_all: this.tailwindIncludeAll(),
      use_trends:  this.tailwindUseTrends(),
    };
  }

  async rerunTailwindSweep() {
    if (!this._fileName()) return;
    await this._postRerun('tailwind', this._tailwindBase());
  }

  async rerunTailwindFilter(filter: TailwindFilter) {
    if (!this._fileName()) return;
    await this._postRerun('tailwind', { ...this._tailwindBase(), filter });
  }

  async rerunTailwindSelected() {
    if (!this._fileName()) return;
    const ids = Array.from(this.selectedIds());
    if (!ids.length) return;
    await this._postRerun('tailwind', { ...this._tailwindBase(), video_ids: ids });
  }

  // ── Logs ───────────────────────────────────────────────────────────────────
  async clearLogs() {
    await fetch('/shorts-analyzer/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }

  // ── Delete file ────────────────────────────────────────────────────────────
  openDeleteModal()  { this.showDeleteModal.set(true); }
  cancelDelete()     { this.showDeleteModal.set(false); }

  async confirmDelete() {
    const name = this._fileName();
    if (!name) return;
    this.deleting.set(true);
    try {
      const res = await fetch(`/shorts-analyzer/results/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) {
        this.showDeleteModal.set(false);
        this.backToFiles();
      }
    } finally {
      this.deleting.set(false);
    }
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
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

  formatViews(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  }

  phaseLabel(phase: VideoPhaseState): string {
    if (!phase.present) return 'missing';
    if (phase.stale_reasons.length === 0) return 'fresh';
    return phase.stale_reasons.join(', ');
  }

  phaseClass(phase: VideoPhaseState): string {
    if (!phase.present) return 'phase-missing';
    if (phase.stale_reasons.length === 0) return 'phase-fresh';
    return 'phase-stale';
  }

  kindLabel(kind: FileKind): string {
    return ({ main: 'Corpus', synthesis: 'Synthesis', tailwind: 'Tailwind', context: 'Context', other: 'Other' })[kind];
  }

  kindIcon(kind: FileKind): string {
    return ({ main: '📊', synthesis: '📝', tailwind: '💨', context: '🧩', other: '📄' })[kind];
  }
}
