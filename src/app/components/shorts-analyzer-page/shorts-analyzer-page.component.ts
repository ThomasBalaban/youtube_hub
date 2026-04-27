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

type ViewState = 'list' | 'videos' | 'video' | 'raw' | 'synthesis' | 'context';

// ── Raw shapes from on-disk JSON ────────────────────────────────────────────
interface RetentionPoint { pct: number; watch_ratio: number; }

interface AnalyticsBlock {
  breakout_score?: number;
  avg_view_percentage?: number;
  estimated_minutes_watched?: number;
  retention_curve?: RetentionPoint[];
}

interface AttributionClaim {
  claim?: string;
  evidence?: string;
  confidence?: 'low' | 'medium' | 'high' | string;
}

interface RetentionInterpretation {
  opening_drop_off?: string;
  mid_video?: string;
  end_behavior?: string;
  avg_view_percentage_read?: string;
}

interface GeminiAnalysis {
  title?: { text?: string; why_it_worked?: string };
  hook?: { description?: string; why_it_worked?: string };
  video_description?: string;
  why_the_video_worked?: string;
  what_could_have_been_better?: string;
  retention_interpretation?: RetentionInterpretation;
  attribution?: {
    replicable_craft?: AttributionClaim;
    borrowed_equity?: AttributionClaim;
    channel_specific_equity?: AttributionClaim;
    probable_external_tailwind?: AttributionClaim;
  };
  tags?: Record<string, string[]>;
}

interface CorpusShort {
  rank: number;
  video_id: string;
  url: string;
  title: string;
  views: number;
  published_date: string;
  duration_seconds?: number;
  breakout_score: number | null;
  analytics?: AnalyticsBlock | null;
  gemini_analysis?: GeminiAnalysis | null;
}

interface CorpusRaw {
  metadata?: { channel_url?: string; total_shorts_analyzed?: number; gemini_model?: string };
  shorts: CorpusShort[];
}

interface SynthesisRaw {
  metadata?: { generated_at?: string; gemini_model?: string; total_shorts?: number; small_corpus_warning?: boolean };
  narrative?: {
    top_quintile_signature?: string;
    bottom_quintile_signature?: string;
    load_bearing_patterns?: string;
    conditional_insights?: string;
    cautions?: string;
  };
  corpus_stats?: {
    total_shorts?: number;
    breakout_score?: { n: number; min: number; max: number; mean: number; median: number };
    views?:          { n: number; min: number; max: number; mean: number; median: number };
  };
  quintiles?: {
    top_threshold?: number; bottom_threshold?: number;
    n_top?: number; n_bottom?: number;
    top_video_ids?: string[]; bottom_video_ids?: string[];
  };
  tag_frequencies?: Record<string, Record<string, {
    overall: { count: number; rate: number };
    top_quintile: { count: number; rate: number };
    bottom_quintile: { count: number; rate: number };
    lift_top_vs_overall: number;
    lift_bottom_vs_overall: number;
    avg_breakout_score_when_present: number;
  }>>;
  unique_to_breakouts?: Array<{ axis: string; tag: string; overall_rate: number; n_overall: number; avg_breakout_when_present: number }>;
  absent_from_breakouts?: Array<{ axis: string; tag: string; overall_rate: number; n_overall: number; avg_breakout_when_present: number }>;
  shared_baseline_traits?: Array<{ axis: string; tag: string; top_rate: number; bottom_rate: number; overall_rate: number }>;
  conditional_patterns?: Array<{
    when: { axis: string; tag: string };
    with: { axis: string; tag: string };
    mean_breakout_when_A: number;
    mean_breakout_when_A_and_B: number;
    mean_breakout_when_A_not_B: number;
    lift_B_given_A: number;
    n_A: number; n_A_and_B: number; n_A_not_B: number;
  }>;
}

interface ContextRaw {
  built_at?: string;
  overall_median?: number;
  monthly_medians?: Record<string, number>;
  videos?: Record<string, unknown>;
}

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

  // Per-file payloads loaded for the structured renderers
  corpusRaw      = signal<CorpusRaw | null>(null);
  tailwindRaw    = signal<Record<string, unknown> | null>(null);
  synthesisData  = signal<SynthesisRaw | null>(null);
  contextData    = signal<ContextRaw | null>(null);

  // Active video (in-panel detail view)
  currentVideoId = signal<string | null>(null);

  // Synthesis dashboard sub-controls
  synthesisActiveAxis = signal<string | null>(null);

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
          const v = this.viewState();
          if (v === 'videos' || v === 'video') {
            await Promise.all([this.loadVideos(f), this.loadCorpusRaw(f), this.loadSiblingTailwind(f)]);
          } else if (v === 'synthesis') {
            await this.loadSynthesis(f);
          } else if (v === 'context') {
            await this.loadContext(f);
          } else if (v === 'raw') {
            await this.loadRaw(f);
          }
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
    this.currentVideoId.set(null);
    if (this.viewState() === 'video') this.viewState.set('videos');
    const kind = this.fileKind(file.name);
    if (kind === 'main') {
      this.viewState.set('videos');
      await Promise.all([this.loadVideos(file), this.loadCorpusRaw(file), this.loadSiblingTailwind(file)]);
    } else if (kind === 'synthesis') {
      this.viewState.set('synthesis');
      await this.loadSynthesis(file);
    } else if (kind === 'context') {
      this.viewState.set('context');
      await this.loadContext(file);
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

  async loadCorpusRaw(file: ResultFile) {
    this.corpusRaw.set(null);
    const res = await fetch(`/shorts-analyzer/results/read?name=${encodeURIComponent(file.name)}`).catch(() => null);
    if (res?.ok) this.corpusRaw.set(await res.json() as CorpusRaw);
  }

  // Try to load <base>.tailwind.json if it exists; silent on miss.
  async loadSiblingTailwind(file: ResultFile) {
    this.tailwindRaw.set(null);
    const base = this.baseHandle(file.name);
    const tailwindName = `${base}.tailwind.json`;
    if (!this.files().some(f => f.name === tailwindName)) return;
    const res = await fetch(`/shorts-analyzer/results/read?name=${encodeURIComponent(tailwindName)}`).catch(() => null);
    if (res?.ok) this.tailwindRaw.set(await res.json() as Record<string, unknown>);
  }

  async loadSynthesis(file: ResultFile) {
    this.loadingFile.set(true);
    this.synthesisData.set(null);
    const res = await fetch(`/shorts-analyzer/results/read?name=${encodeURIComponent(file.name)}`).catch(() => null);
    if (res?.ok) {
      const data = await res.json() as SynthesisRaw;
      this.synthesisData.set(data);
      const axes = Object.keys(data.tag_frequencies ?? {});
      if (axes.length) this.synthesisActiveAxis.set(axes[0]);
    }
    this.loadingFile.set(false);
  }

  async loadContext(file: ResultFile) {
    this.loadingFile.set(true);
    this.contextData.set(null);
    const res = await fetch(`/shorts-analyzer/results/read?name=${encodeURIComponent(file.name)}`).catch(() => null);
    if (res?.ok) this.contextData.set(await res.json() as ContextRaw);
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
    this.corpusRaw.set(null);
    this.tailwindRaw.set(null);
    this.synthesisData.set(null);
    this.contextData.set(null);
    this.selectedIds.set(new Set());
    this.currentVideoId.set(null);
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

  // ── Breadcrumbs ────────────────────────────────────────────────────────────
  breadcrumbs = computed<Array<{ label: string; sub?: string; click?: () => void; current?: boolean }>>(() => {
    const crumbs: Array<{ label: string; sub?: string; click?: () => void; current?: boolean }> = [];
    const v = this.viewState();
    const file = this.selectedFile();

    crumbs.push({
      label: 'Output Files',
      click: v === 'list' ? undefined : () => this.backToFiles(),
      current: v === 'list',
    });

    if (file && v !== 'list') {
      const kind = this.fileKind(file.name);
      const isVideo = v === 'video';
      crumbs.push({
        label: file.name,
        sub: this.kindLabel(kind),
        click: isVideo ? () => this.backToVideos() : undefined,
        current: !isVideo,
      });
    }

    if (v === 'video') {
      const title = this.currentShort()?.title ?? this.currentRow()?.title ?? this.currentVideoId() ?? '';
      crumbs.push({
        label: title,
        sub: this.currentVideoId() ?? undefined,
        current: true,
      });
    }

    return crumbs;
  });

  // ── Video detail view ──────────────────────────────────────────────────────
  openVideo(videoId: string) {
    this.currentVideoId.set(videoId);
    this.viewState.set('video');
  }

  backToVideos() {
    this.currentVideoId.set(null);
    this.viewState.set('videos');
  }

  currentShort = computed<CorpusShort | null>(() => {
    const id = this.currentVideoId();
    if (!id) return null;
    return this.corpusRaw()?.shorts.find(s => s.video_id === id) ?? null;
  });

  currentRow = computed<VideoRow | null>(() => {
    const id = this.currentVideoId();
    if (!id) return null;
    return this.videosResponse()?.videos.find(v => v.video_id === id) ?? null;
  });

  currentTailwind = computed<unknown | null>(() => {
    const id = this.currentVideoId();
    if (!id) return null;
    const tw = this.tailwindRaw();
    if (!tw) return null;
    if (typeof tw === 'object' && id in tw) return (tw as Record<string, unknown>)[id];
    const byVideo = (tw as { videos?: Record<string, unknown>; per_video?: Record<string, unknown> });
    return byVideo.videos?.[id] ?? byVideo.per_video?.[id] ?? null;
  });

  currentTags = computed<Array<{ axis: string; values: string[] }>>(() => {
    const tags = this.currentShort()?.gemini_analysis?.tags ?? {};
    return Object.entries(tags)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([axis, values]) => ({ axis, values: values as string[] }));
  });

  // Open a video from the synthesis view; switches to corpus view if needed.
  async jumpToVideoFromSynthesis(videoId: string) {
    const file = this.selectedFile();
    if (!file) return;
    const corpusName = `${this.baseHandle(file.name)}.json`;
    const corpusFile = this.files().find(f => f.name === corpusName);
    if (!corpusFile) return;
    await this.openFile(corpusFile);
    this.openVideo(videoId);
  }

  // ── Retention sparkline (plain SVG) ────────────────────────────────────────
  readonly sparkW = 460;
  readonly sparkH = 110;
  readonly sparkPad = { l: 28, r: 8, t: 6, b: 16 };

  sparkScale(curve: RetentionPoint[]) {
    const xs = curve.map(p => p.pct);
    const ys = curve.map(p => p.watch_ratio);
    const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 100);
    const yMax = Math.max(...ys, 1.05);
    const yMin = 0;
    const innerW = this.sparkW - this.sparkPad.l - this.sparkPad.r;
    const innerH = this.sparkH - this.sparkPad.t - this.sparkPad.b;
    const x = (pct: number) => this.sparkPad.l + ((pct - xMin) / (xMax - xMin)) * innerW;
    const y = (r: number)   => this.sparkPad.t + (1 - (r - yMin) / (yMax - yMin)) * innerH;
    return { x, y, xMin, xMax, yMin, yMax, innerW, innerH };
  }

  retentionLinePath(curve: RetentionPoint[]): string {
    if (!curve?.length) return '';
    const { x, y } = this.sparkScale(curve);
    return curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.pct).toFixed(1)},${y(p.watch_ratio).toFixed(1)}`).join(' ');
  }

  retentionAreaPath(curve: RetentionPoint[]): string {
    if (!curve?.length) return '';
    const { x, y, innerH } = this.sparkScale(curve);
    const baseY = this.sparkPad.t + innerH;
    const top = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.pct).toFixed(1)},${y(p.watch_ratio).toFixed(1)}`).join(' ');
    const last = curve[curve.length - 1];
    const first = curve[0];
    return `${top} L${x(last.pct).toFixed(1)},${baseY.toFixed(1)} L${x(first.pct).toFixed(1)},${baseY.toFixed(1)} Z`;
  }

  retentionRefY(curve: RetentionPoint[]): number {
    return this.sparkScale(curve).y(1.0);
  }

  retentionAxisTicks(curve: RetentionPoint[]): Array<{ pct: number; x: number }> {
    if (!curve?.length) return [];
    const { x } = this.sparkScale(curve);
    return [0, 25, 50, 75, 100].map(p => ({ pct: p, x: x(p) }));
  }

  // ── Synthesis helpers ──────────────────────────────────────────────────────
  setSynthesisAxis(axis: string) { this.synthesisActiveAxis.set(axis); }

  synthesisAxes = computed<string[]>(() => Object.keys(this.synthesisData()?.tag_frequencies ?? {}));

  synthesisAxisTags = computed<Array<{
    tag: string;
    overall_count: number; overall_rate: number;
    top_count: number; top_rate: number;
    bottom_count: number; bottom_rate: number;
    lift_top: number; lift_bottom: number;
    avg_breakout: number;
  }>>(() => {
    const ax = this.synthesisActiveAxis();
    const data = this.synthesisData()?.tag_frequencies?.[ax ?? ''];
    if (!data) return [];
    return Object.entries(data)
      .map(([tag, v]) => ({
        tag,
        overall_count: v.overall.count, overall_rate: v.overall.rate,
        top_count:     v.top_quintile.count, top_rate: v.top_quintile.rate,
        bottom_count:  v.bottom_quintile.count, bottom_rate: v.bottom_quintile.rate,
        lift_top:      v.lift_top_vs_overall,
        lift_bottom:   v.lift_bottom_vs_overall,
        avg_breakout:  v.avg_breakout_score_when_present,
      }))
      .sort((a, b) => b.lift_top - a.lift_top);
  });

  conditionalSorted = computed(() => {
    const rows = this.synthesisData()?.conditional_patterns ?? [];
    return [...rows].sort((a, b) => b.lift_B_given_A - a.lift_B_given_A);
  });

  // ── Context helpers ────────────────────────────────────────────────────────
  monthlyMediansSorted = computed<Array<{ month: string; median: number }>>(() => {
    const m = this.contextData()?.monthly_medians ?? {};
    return Object.entries(m).map(([month, median]) => ({ month, median: median as number }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  contextChartPath(): { line: string; area: string; ticks: Array<{ x: number; label: string }>; yMax: number } {
    const points = this.monthlyMediansSorted();
    if (!points.length) return { line: '', area: '', ticks: [], yMax: 0 };
    const w = 460, h = 110, padL = 36, padR = 8, padT = 6, padB = 18;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const yMax = Math.max(...points.map(p => p.median), 1) * 1.1;
    const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v: number) => padT + (1 - v / yMax) * innerH;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.median).toFixed(1)}`).join(' ');
    const baseY = padT + innerH;
    const area = `${line} L${x(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`;
    const ticks = points.map((p, i) => ({ x: x(i), label: p.month.slice(2) }));   // YYYY-MM → YY-MM
    return { line, area, ticks, yMax };
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

  formatPct(v: number | null | undefined, digits = 1): string {
    if (v == null) return '—';
    return `${v.toFixed(digits)}%`;
  }

  formatRatio(v: number | null | undefined, digits = 2): string {
    if (v == null) return '—';
    return v.toFixed(digits);
  }

  formatNumber(v: number | null | undefined): string {
    if (v == null) return '—';
    return v.toLocaleString();
  }

  // Pretty-print a tag axis name: "title_mechanics" → "Title Mechanics"
  prettyAxis(axis: string): string {
    return axis.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  confidenceClass(c: string | undefined): string {
    if (c === 'high')   return 'conf-high';
    if (c === 'medium') return 'conf-med';
    if (c === 'low')    return 'conf-low';
    return 'conf-unknown';
  }

  isNonEmpty(v: unknown): boolean {
    return v != null && v !== '';
  }

  objectEntries<T>(o: Record<string, T> | undefined | null): Array<{ key: string; value: T }> {
    if (!o) return [];
    return Object.entries(o).map(([key, value]) => ({ key, value }));
  }
}
