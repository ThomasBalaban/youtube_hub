import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { PollingComponent } from '../../shared/polling.component';

interface ServiceStatus { id: string; status: string; pid: number | null; }

interface CutRow {
  cut_id: string;
  video_id: string | null;
  edit_decisions: Record<string, unknown>;
  title: string | null;
  breakout_score: number | null;
  retention_curve: number[] | null;
}

interface ExperimentRow {
  experiment_id: string;
  channel_handle: string;
  hypothesis: string;
  arms: Array<Record<string, unknown>>;
  success_metric: string;
  status: string;
  conclusion: string | null;
}

interface TraceListEntry {
  trace_id: string;
  modified: number;
}

interface ThinkerStatus {
  state: 'stopped' | 'running' | 'idle' | 'error';
  started_at: number | null;
  last_tick_at: number | null;
  last_drained_at: number | null;
  current_task: { task_type: string; key: string; description: string } | null;
  queue_depth: number;
  session_tasks_run: number;
  session_tasks_skipped: number;
  errors: Array<{ at: number; msg: string; detail: string[] }>;
  last_snapshot: {
    channel_handle: string;
    per_short_count: number;
    tailwind_count: number;
    synthesis_present: boolean;
    context_present: boolean;
    pre_publish_count: number;
    missing: string[];
  } | null;
  forced: Array<[string, string]>;
}

interface QueueTask {
  task_type: string;
  key: string;
  category: string;
  input_hash: string;
  depends_on: Array<[string, string]>;
  description: string;
}

interface RecommendationItem {
  category: string;
  key: string;
  path: string;
  modified: number;
  size_bytes: number;
  input_hash: string | null;
  task_type: string | null;
  trace_id: string | null;
}

type Tab = 'recommendations' | 'cuts' | 'experiments' | 'traces';
type RecCategory = 'postmortems' | 'tailwind_critiques' | 'titles' | 'channel' | 'capabilities' | 'edits';

@Component({
  selector: 'app-strategist-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './strategist-page.component.html',
  styleUrl: './strategist-page.component.scss',
})
export class StrategistPageComponent extends PollingComponent {
  protected override pollingInterval = 3000;

  // ── Core service state ────────────────────────────────────────────────────
  serviceStatus  = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  apiOnline      = signal(false);
  lastUpdated    = signal('—');
  logs           = signal<string[]>([]);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  activeTab = signal<Tab>('recommendations');

  // ── Layout: draggable left/right pane divider ─────────────────────────────
  private readonly _LS_LEFT_WIDTH = 'strategist-left-width';
  leftPaneWidth = signal<number>(this._restoreLeftWidth());
  resizing      = signal(false);

  private _restoreLeftWidth(): number {
    try {
      const v = Number(localStorage.getItem('strategist-left-width'));
      if (Number.isFinite(v) && v >= 280 && v <= 1400) return v;
    } catch { /* ignore */ }
    return 480;
  }

  private _resizeMove?: (e: MouseEvent) => void;
  private _resizeUp?: () => void;

  startResize(ev: MouseEvent) {
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = this.leftPaneWidth();
    this.resizing.set(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    this._resizeMove = (e: MouseEvent) => {
      const max = Math.max(320, window.innerWidth - 360);
      const next = Math.max(280, Math.min(max, startWidth + (e.clientX - startX)));
      this.leftPaneWidth.set(next);
    };
    this._resizeUp = () => {
      if (this._resizeMove) document.removeEventListener('mousemove', this._resizeMove);
      if (this._resizeUp)   document.removeEventListener('mouseup',   this._resizeUp);
      this._resizeMove = undefined;
      this._resizeUp = undefined;
      this.resizing.set(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(this._LS_LEFT_WIDTH, String(this.leftPaneWidth())); } catch { /* ignore */ }
    };

    document.addEventListener('mousemove', this._resizeMove);
    document.addEventListener('mouseup',   this._resizeUp);
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
    if (this._resizeMove) document.removeEventListener('mousemove', this._resizeMove);
    if (this._resizeUp)   document.removeEventListener('mouseup',   this._resizeUp);
  }

  // ── Thinker ───────────────────────────────────────────────────────────────
  thinker          = signal<ThinkerStatus | null>(null);
  thinkerQueue     = signal<QueueTask[]>([]);
  thinkerActionPending = signal(false);

  recCategory   = signal<RecCategory>('channel');
  recItems      = signal<RecommendationItem[]>([]);
  recLoading    = signal(false);
  selectedRec   = signal<{ category: string; key: string; body: any } | null>(null);
  recViewMode   = signal<'structured' | 'raw'>('structured');

  readonly recCategories: Array<{ id: RecCategory; label: string }> = [
    { id: 'channel',            label: 'Channel reports' },
    { id: 'titles',             label: 'Title recs' },
    { id: 'edits',              label: 'Edit reviews' },
    { id: 'capabilities',       label: 'Capability gaps' },
    { id: 'postmortems',        label: 'Postmortems' },
    { id: 'tailwind_critiques', label: 'Tailwind critiques' },
  ];

  // ── Cuts ──────────────────────────────────────────────────────────────────
  readonly channelHandle = 'PeepingOtter';
  cuts          = signal<CutRow[]>([]);
  cutsLoading   = signal(false);
  cutsError     = signal('');

  // ── Experiments ───────────────────────────────────────────────────────────
  experiments        = signal<ExperimentRow[]>([]);
  experimentsLoading = signal(false);

  // ── Traces ────────────────────────────────────────────────────────────────
  traces         = signal<TraceListEntry[]>([]);
  selectedTrace  = signal<unknown | null>(null);
  selectedTraceId = signal<string | null>(null);
  traceLoading   = signal(false);

  // ── Computed ──────────────────────────────────────────────────────────────
  isStarting = computed(() => this.serviceStatus()?.status === 'starting');

  statusMeta = computed(() => {
    const s = this.serviceStatus()?.status ?? 'unknown';
    const map: Record<string, { label: string; color: string; icon: string }> = {
      online:    { label: 'Running',   color: '#fb923c', icon: '●' },
      offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
      starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
      stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
      unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
      unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
    };
    return map[s] ?? map['unknown'];
  });

  // ── Polling ───────────────────────────────────────────────────────────────
  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await res.json();
        const svc = svcs.find(s => s.id === 'shorts_strategist_api') ?? null;
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
      const l = await fetch('/shorts-strategist/logs?last=300').catch(() => null);
      if (l?.ok) {
        const d = await l.json();
        this.logs.set(d.lines ?? []);
      }

      // Thinker status is cheap and useful on every poll regardless of tab.
      await this.loadThinker();

      // Auto-load whichever tab is open
      if (this.activeTab() === 'recommendations') {
        await this.loadRecommendations(true);
      } else if (this.activeTab() === 'cuts' && !this.cutsLoading()) {
        await this.loadCuts();
      } else if (this.activeTab() === 'experiments' && !this.experimentsLoading()) {
        await this.loadExperiments();
      } else if (this.activeTab() === 'traces') {
        await this.loadTraces();
      }
    }

    this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
  }

  // ── Thinker ───────────────────────────────────────────────────────────────
  async loadThinker() {
    if (!this.apiOnline()) return;
    const [s, q] = await Promise.allSettled([
      fetch('/shorts-strategist/thinker/status'),
      fetch('/shorts-strategist/thinker/queue'),
    ]);
    if (s.status === 'fulfilled' && s.value.ok)
      this.thinker.set(await s.value.json() as ThinkerStatus);
    if (q.status === 'fulfilled' && q.value.ok) {
      const d = await q.value.json();
      this.thinkerQueue.set((d.tasks ?? []) as QueueTask[]);
    }
  }

  async thinkerAction(act: 'start' | 'stop') {
    if (this.thinkerActionPending() || !this.apiOnline()) return;
    this.thinkerActionPending.set(true);
    try {
      const res = await fetch(`/shorts-strategist/thinker/${act}`, { method: 'POST' });
      if (res.ok) this.thinker.set(await res.json() as ThinkerStatus);
    } finally {
      this.thinkerActionPending.set(false);
    }
  }

  // Tracks in-flight force requests so the UI can disable the button between
  // the user's click and the next poll, when the queue/forced state hasn't
  // yet caught up with the new request.
  pendingForce = signal<Set<string>>(new Set());

  private _forceKey(task_type: string, key: string | null): string {
    return `${task_type}/${key ?? '*'}`;
  }

  isTaskPending(task_type: string | null | undefined, key: string): boolean {
    if (!task_type) return false;
    if (this.pendingForce().has(this._forceKey(task_type, key))) return true;
    const t = this.thinker();
    if (t?.current_task?.task_type === task_type && t.current_task.key === key) return true;
    if (t?.forced?.some(([tt, k]) => tt === task_type && (k === '*' || k === key))) return true;
    if (this.thinkerQueue().some(q => q.task_type === task_type && q.key === key)) return true;
    return false;
  }

  async forceTask(task_type: string, key: string | null = null) {
    if (!this.apiOnline()) return;
    if (key !== null && this.isTaskPending(task_type, key)) return;
    const fkey = this._forceKey(task_type, key);
    this.pendingForce.update(s => { const n = new Set(s); n.add(fkey); return n; });
    try {
      await fetch('/shorts-strategist/thinker/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(key ? { task_type, key } : { task_type }),
      }).catch(() => {});
      await this.loadThinker();
    } finally {
      this.pendingForce.update(s => { const n = new Set(s); n.delete(fkey); return n; });
    }
  }

  async loadRecommendations(isRefresh = false) {
    if (!this.apiOnline()) return;
    if (!isRefresh) this.recLoading.set(true);
    try {
      const res = await fetch(`/shorts-strategist/recommendations/${this.recCategory()}`);
      if (res.ok) {
        const d = await res.json();
        this.recItems.set((d.items ?? []) as RecommendationItem[]);
      } else if (!isRefresh) {
        this.recItems.set([]);
      }
    } finally {
      if (!isRefresh) this.recLoading.set(false);
    }
  }

  async openRecommendation(item: RecommendationItem) {
    const res = await fetch(`/shorts-strategist/recommendations/${item.category}/${encodeURIComponent(item.key)}`);
    if (res.ok) {
      this.selectedRec.set({ category: item.category, key: item.key, body: await res.json() });
    }
  }

  closeRecommendation() {
    this.selectedRec.set(null);
  }

  setRecCategory(cat: RecCategory) {
    this.recCategory.set(cat);
    this.selectedRec.set(null);
    this.loadRecommendations();
  }

  prettyRec = computed(() => {
    const r = this.selectedRec();
    if (!r) return '';
    try { return JSON.stringify(r.body, null, 2); } catch { return String(r.body); }
  });

  // ── Recommendation payload accessors ──────────────────────────────────────
  // The thinker writes artifacts as { task_type, category, key, input_hash,
  // generated_at, trace_id, payload }. The structured renderers below all
  // operate on payload, so this little switch keeps the templates terse.
  recPayload = computed<any>(() => {
    const sel = this.selectedRec();
    if (!sel || !sel.body) return null;
    const body: any = sel.body;
    return body.payload ?? body;
  });

  recTaskType = computed<string>(() => {
    const sel = this.selectedRec();
    return (sel?.body as any)?.task_type ?? 'unknown';
  });

  // ── Tag-drift verdict styling ─────────────────────────────────────────────
  driftVerdictClass(v: string): string {
    return ({
      loser_pattern_dominating_recent: 'drift-bad-now',
      winner_pattern_being_dropped:    'drift-good-lost',
      loser_pattern:                   'drift-bad',
      winner_pattern:                  'drift-good',
    } as Record<string, string>)[v] ?? '';
  }
  driftVerdictLabel(v: string): string {
    return ({
      loser_pattern_dominating_recent: 'loser pattern is dominating recent',
      winner_pattern_being_dropped:    'winner pattern being dropped',
      loser_pattern:                   'loser pattern',
      winner_pattern:                  'winner pattern',
    } as Record<string, string>)[v] ?? v;
  }

  // ── Critic verdict styling ────────────────────────────────────────────────
  criticVerdictClass(v: string | null | undefined): string {
    if (!v) return 'verdict-unknown';
    return `verdict-${v}`;
  }

  // Format a percentage bar width (capped at 100).
  pctWidth(pct: number | null | undefined): string {
    if (typeof pct !== 'number' || isNaN(pct)) return '0%';
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  // Format a small number for display.
  fmtNum(n: number | null | undefined, digits = 2): string {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return n.toFixed(digits);
  }

  // For the monthly trajectory bars, normalize against the largest median.
  trajectoryMaxViews = computed<number>(() => {
    const traj = this.recPayload()?.monthly_trajectory ?? [];
    let max = 0;
    for (const r of traj) {
      const v = r?.median_views;
      if (typeof v === 'number' && v > max) max = v;
    }
    return max || 1;
  });

  // Recent-N months only — the full trajectory is 30+ rows for active channels.
  recentTrajectory = computed<any[]>(() => {
    const traj = this.recPayload()?.monthly_trajectory ?? [];
    return traj.slice(-12);
  });

  isRecommendedAlt(rank: number | undefined): boolean {
    const p = this.recPayload();
    return p?.verdict === 'replace' && p?.replace_with_rank === rank;
  }

  thinkerStateMeta = computed(() => {
    const s = this.thinker()?.state ?? 'stopped';
    const map: Record<string, { label: string; color: string }> = {
      running: { label: 'Running',  color: '#34d399' },
      idle:    { label: 'Idle (caught up)', color: '#3b82f6' },
      stopped: { label: 'Stopped',  color: '#6b7280' },
      error:   { label: 'Error',    color: '#ef4444' },
    };
    return map[s] ?? map['stopped'];
  });

  formatTime(ts: number | null | undefined): string {
    if (!ts) return '—';
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return new Date(ts * 1000).toLocaleTimeString();
  }

  // ── Cuts ──────────────────────────────────────────────────────────────────
  async loadCuts() {
    if (!this.apiOnline()) return;
    this.cutsLoading.set(true);
    this.cutsError.set('');
    try {
      const res = await fetch(`/shorts-strategist/strategy/cuts?channel_handle=${encodeURIComponent(this.channelHandle)}`);
      if (!res.ok) {
        this.cutsError.set(`HTTP ${res.status}`);
        this.cuts.set([]);
        return;
      }
      this.cuts.set(await res.json() as CutRow[]);
    } catch (e: any) {
      this.cutsError.set(e?.message ?? 'Failed to load cuts');
    } finally {
      this.cutsLoading.set(false);
    }
  }

  // ── Experiments ───────────────────────────────────────────────────────────
  async loadExperiments() {
    if (!this.apiOnline()) return;
    this.experimentsLoading.set(true);
    try {
      const res = await fetch(`/shorts-strategist/experiment/list?channel_handle=${encodeURIComponent(this.channelHandle)}`);
      if (res.ok) this.experiments.set(await res.json() as ExperimentRow[]);
    } finally {
      this.experimentsLoading.set(false);
    }
  }

  // ── Traces ────────────────────────────────────────────────────────────────
  async loadTraces() {
    if (!this.apiOnline()) return;
    const res = await fetch('/shorts-strategist/traces?limit=100').catch(() => null);
    if (res?.ok) this.traces.set(await res.json() as TraceListEntry[]);
  }

  async openTrace(traceId: string) {
    this.selectedTraceId.set(traceId);
    this.selectedTrace.set(null);
    this.traceLoading.set(true);
    try {
      const res = await fetch(`/shorts-strategist/traces/${encodeURIComponent(traceId)}`);
      if (res.ok) this.selectedTrace.set(await res.json());
    } finally {
      this.traceLoading.set(false);
    }
  }

  closeTrace() {
    this.selectedTrace.set(null);
    this.selectedTraceId.set(null);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  setTab(t: Tab) {
    this.activeTab.set(t);
    if (this.apiOnline()) {
      if (t === 'recommendations') this.loadRecommendations();
      else if (t === 'cuts') this.loadCuts();
      else if (t === 'experiments') this.loadExperiments();
      else if (t === 'traces') this.loadTraces();
    }
  }

  // ── Logs ──────────────────────────────────────────────────────────────────
  async clearLogs() {
    await fetch('/shorts-strategist/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }

  isErr  = (l: string) => /error|failed|exception|traceback|fatal|❌|503|500/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);
  isOk   = (l: string) => /✅|success|complete|200 ok/i.test(l);

  // ── Formatting ────────────────────────────────────────────────────────────
  prettyTrace = computed(() => {
    const t = this.selectedTrace();
    if (t == null) return '';
    try { return JSON.stringify(t, null, 2); } catch { return String(t); }
  });

  prettyDecisions(d: Record<string, unknown>): string {
    try { return JSON.stringify(d, null, 2); } catch { return String(d); }
  }

  formatDate(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  formatScore(v: number | null): string {
    if (v == null) return '—';
    return v.toFixed(2);
  }

}
