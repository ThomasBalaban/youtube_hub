import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PollingComponent } from '../../shared/polling.component';
import { PageHeaderComponent } from '../page-header/page-header.component';

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

interface AnalyzerStatus {
  base_url: string;
  checked_at: number;
  connected: boolean;
  channel_handle: string;
  channel_files: { analysis: boolean; synthesis: boolean; tailwind: boolean } | null;
}

interface ServiceStatus {
  id: string;
  status: string;
  pid: number | null;
}

interface ThinkerStatus {
  state: 'stopped' | 'running' | 'idle' | 'error';
  queue_depth: number;
  current_task: { task_type: string; key: string } | null;
}

interface LogFile {
  name: string;
  path: string;
  modified: number;
  size: number;
}

interface Region { x: number; y: number; w: number; h: number; }

interface RegionPreset {
  name: string;
  image: string;       // data-URL thumbnail of a reference frame ('' if none)
  camera: Region;
  gameplay: Region;
}

// Sensible starting layout for a brand-new preset: VTuber bottom half,
// gameplay top third (the current OBS scene).
const DEFAULT_CAMERA_REGION:   Region = { x: 0, y: 0.5, w: 1, h: 0.5 };
const DEFAULT_GAMEPLAY_REGION: Region = { x: 0, y: 0,   w: 1, h: 0.34 };

const ANIMATION_TYPES = [
  'Auto', 'Drift & Fade', 'Wiggle', 'Pop & Shrink',
  'Shake', 'Pulse', 'Wave', 'Explode-Out', 'Hyper Bounce', 'Static',
];

@Component({
  selector: 'app-subtitler-page',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './subtitler-page.component.html',
  styleUrl:    './subtitler-page.component.scss',
})
export class SubtitlerPageComponent extends PollingComponent {
  protected override pollingInterval = 5000;

  readonly animationTypes = ANIMATION_TYPES;
  readonly Math = Math;

  // ── Core state ─────────────────────────────────────────────────────────────
  files          = signal<FileEntry[]>([]);
  processStatus  = signal<ProcessStatus | null>(null);
  settings       = signal<SubtitlerSettings>({
    animation_type: 'Auto',
    sync_offset:    -0.15,
    output_dir:     '',
    enable_trimming: true,
  });
  analyzerStatus = signal<AnalyzerStatus | null>(null);
  serviceStatus  = signal<ServiceStatus | null>(null);
  strategistOnline = signal(false);
  thinker        = signal<ThinkerStatus | null>(null);
  launcherOnline = signal(false);
  apiOnline      = signal(false);
  logs           = signal<string[]>([]);
  lastUpdated    = signal('—');
  saving         = signal(false);
  saveDone       = signal(false);
  saveError      = signal('');
  settingsLoaded = signal(false);

  // ── Log viewer state ───────────────────────────────────────────────────────
  logViewState      = signal<'list' | 'file'>('list');
  logFiles          = signal<LogFile[]>([]);
  selectedLogFile   = signal<LogFile | null>(null);
  selectedLogContent = signal<string>('');
  logFileLoading    = signal(false);

  // ── Right-panel tab + layout-region state ───────────────────────────────────
  rightPanelTab    = signal<'logs' | 'layout'>('logs');
  regionPresets    = signal<RegionPreset[]>([]);
  activePreset     = signal<string>('');
  regionsLoaded    = signal(false);
  editingRegion    = signal<'camera' | 'gameplay'>('camera');
  regionsSaving    = signal(false);
  regionsSaveDone  = signal(false);
  regionsSaveError = signal('');
  draggingRegion   = signal(false);
  private interaction: {
    mode: 'draw' | 'move' | 'resize';
    handle: string;
    startX: number;
    startY: number;
    startRegion: Region;
  } | null = null;

  // Reference-frame picker state
  pickingFrame  = signal(false);
  videoUrl      = signal<string>('');
  videoDuration = signal(0);
  videoTime     = signal(0);

  currentPreset = computed(() =>
    this.regionPresets().find(p => p.name === this.activePreset()) ?? null);

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

  // ── Settings setters ───────────────────────────────────────────────────────
  setAnimationType(v: string)   { this.settings.update(s => ({ ...s, animation_type: v })); }
  setSyncOffset(v: number)      { this.settings.update(s => ({ ...s, sync_offset: +v })); }
  setOutputDir(v: string)       { this.settings.update(s => ({ ...s, output_dir: v })); }
  toggleTrimming()              { this.settings.update(s => ({ ...s, enable_trimming: !s.enable_trimming })); }

  // ── Thinker meta ───────────────────────────────────────────────────────────
  thinkerOffline = computed(() => {
    if (!this.strategistOnline()) return true;
    const s = this.thinker()?.state;
    return s !== 'running' && s !== 'idle';
  });

  thinkerOfflineReason = computed(() => {
    if (!this.strategistOnline()) return 'The Shorts Strategist API is not running.';
    const s = this.thinker()?.state;
    if (s === 'error')   return 'The thinker hit an error and stopped.';
    if (s === 'stopped') return 'The thinker loop is stopped.';
    return 'The thinker is not running.';
  });

  // ── Analyzer bridge meta ───────────────────────────────────────────────────
  analyzerMeta = computed(() => {
    const a = this.analyzerStatus();
    if (!a)           return { label: 'Analyzer: unknown',  color: '#6b7280', icon: '?' };
    if (!a.connected) return { label: 'Analyzer: offline',  color: '#ef4444', icon: '○' };
    const cf = a.channel_files;
    const have = cf ? Object.values(cf).filter(Boolean).length : 0;
    if (have === 0)   return { label: `Analyzer: ${a.channel_handle} (no data)`, color: '#f59e0b', icon: '◌' };
    return                   { label: `Analyzer: ${a.channel_handle}`,           color: '#34d399', icon: '●' };
  });

  // ── Log helpers ────────────────────────────────────────────────────────────
  isErr  = (l: string) => /error|failed|exception|traceback|fatal|❌/i.test(l);
  isOk   = (l: string) => /✅|success|done|complete/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  // ── File display helpers ───────────────────────────────────────────────────
  fileIcon(status: string): string {
    return { queued: '○', processing: '◌', done: '✓', error: '✗' }[status] ?? '?';
  }
  fileColor(status: string): string {
    return { queued: '#6b7280', processing: '#3b82f6', done: '#34d399', error: '#ef4444' }[status] ?? '#6b7280';
  }
  basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Polling ────────────────────────────────────────────────────────────────
  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await res.json();
        const svc = svcs.find(s => s.id === 'shorts_auto_editor_api') ?? null;
        this.serviceStatus.set(svc);
        this.apiOnline.set(svc?.status === 'online');
        const strat = svcs.find(s => s.id === 'shorts_strategist_api');
        this.strategistOnline.set(strat?.status === 'online');
      } else {
        this.launcherOnline.set(false);
        this.apiOnline.set(false);
        this.strategistOnline.set(false);
      }
    } catch {
      this.launcherOnline.set(false);
      this.apiOnline.set(false);
      this.strategistOnline.set(false);
    }

    if (this.strategistOnline()) {
      try {
        const r = await fetch('/shorts-strategist/thinker/status');
        if (r.ok) this.thinker.set(await r.json() as ThinkerStatus);
      } catch { /* leave prior value, retry next tick */ }
    } else {
      this.thinker.set(null);
    }

    // Settings load via launcher — always available, no API needed
    if (!this.settingsLoaded()) {
      const r = await fetch('/launcher/subtitler-settings/settings').catch(() => null);
      if (r?.ok) { this.settings.set(await r.json()); this.settingsLoaded.set(true); }
    }

    // Layout region presets load once via launcher (no API needed)
    if (!this.regionsLoaded()) {
      const r = await fetch('/launcher/subtitler-settings/regions').catch(() => null);
      if (r?.ok) {
        const d = await r.json();
        this.regionPresets.set((d.region_presets ?? []) as RegionPreset[]);
        this.activePreset.set(d.active_preset ?? '');
        this.regionsLoaded.set(true);
      }
    }

    if (this.apiOnline()) {
      const [statusRes, filesRes, logsRes, analyzerRes] = await Promise.allSettled([
        fetch('/shorts-editor/process/status'),
        fetch('/shorts-editor/files'),
        fetch('/shorts-editor/logs?last=200'),
        fetch('/shorts-editor/analyzer/status'),
      ]);
      if (statusRes.status === 'fulfilled' && statusRes.value.ok)
        this.processStatus.set(await statusRes.value.json());
      if (filesRes.status === 'fulfilled' && filesRes.value.ok)
        this.files.set(await filesRes.value.json());
      if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
        const d = await logsRes.value.json();
        this.logs.set(d.lines ?? []);
      }
      if (analyzerRes.status === 'fulfilled' && analyzerRes.value.ok)
        this.analyzerStatus.set(await analyzerRes.value.json());
      else
        this.analyzerStatus.set(null);

      // Refresh log file list when in list view
      if (this.logViewState() === 'list') await this.refreshLogFiles();
    } else {
      this.analyzerStatus.set(null);
    }

    this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
  }

  // ── Log viewer ─────────────────────────────────────────────────────────────
  async refreshLogFiles() {
    const dir = this.settings().output_dir;
    if (!dir || !this.apiOnline()) { this.logFiles.set([]); return; }
    const res = await fetch(`/shorts-editor/session-logs/list?dir=${encodeURIComponent(dir)}`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.logFiles.set(d.files ?? []);
    }
  }

  async openLogFile(file: LogFile) {
    this.logFileLoading.set(true);
    this.selectedLogFile.set(file);
    this.logViewState.set('file');
    const res = await fetch(`/shorts-editor/session-logs/read?path=${encodeURIComponent(file.path)}`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.selectedLogContent.set(d.content ?? '');
    } else {
      this.selectedLogContent.set('Could not load file.');
    }
    this.logFileLoading.set(false);
  }

  backToLogList() {
    this.logViewState.set('list');
    this.selectedLogFile.set(null);
    this.selectedLogContent.set('');
    this.refreshLogFiles();
  }

  // ── Layout region editor ─────────────────────────────────────────────────────
  setActivePreset(name: string) { this.activePreset.set(name); }
  setEditingRegion(which: 'camera' | 'gameplay') { this.editingRegion.set(which); }

  private _uniquePresetName(base = 'layout'): string {
    const taken = new Set(this.regionPresets().map(p => p.name));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  newPreset() {
    const name = this._uniquePresetName();
    const preset: RegionPreset = {
      name,
      image: '',
      camera:   { ...DEFAULT_CAMERA_REGION },
      gameplay: { ...DEFAULT_GAMEPLAY_REGION },
    };
    this.regionPresets.update(list => [...list, preset]);
    this.activePreset.set(name);
  }

  duplicatePreset() {
    const cur = this.currentPreset();
    if (!cur) return;
    const name = this._uniquePresetName(`${cur.name} copy`);
    const copy: RegionPreset = {
      name,
      image: cur.image,
      camera:   { ...cur.camera },
      gameplay: { ...cur.gameplay },
    };
    this.regionPresets.update(list => [...list, copy]);
    this.activePreset.set(name);
  }

  deletePreset() {
    const name = this.activePreset();
    if (!name) return;
    const remaining = this.regionPresets().filter(p => p.name !== name);
    this.regionPresets.set(remaining);
    this.activePreset.set(remaining.length ? remaining[0].name : '');
  }

  renamePreset(raw: string) {
    const name = raw.trim();
    const old = this.activePreset();
    if (!name || name === old) return;
    if (this.regionPresets().some(p => p.name === name)) return; // keep names unique
    this.regionPresets.update(list =>
      list.map(p => (p.name === old ? { ...p, name } : p)));
    this.activePreset.set(name);
  }

  private patchCurrentPreset(patch: Partial<RegionPreset>) {
    const name = this.activePreset();
    this.regionPresets.update(list =>
      list.map(p => (p.name === name ? { ...p, ...patch } : p)));
  }

  regionStyle(r: Region) {
    return {
      left:   (r.x * 100) + '%',
      top:    (r.y * 100) + '%',
      width:  (r.w * 100) + '%',
      height: (r.h * 100) + '%',
    };
  }

  // The active region's box can be drawn fresh, moved, or resized by its
  // 8 handles. Dragging empty canvas draws a new box; dragging the box body
  // moves it; dragging a handle resizes from that edge/corner. Everything is
  // clamped so the box never leaves the 0–1 frame.
  readonly resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  private _editingRect(): Region {
    const p = this.currentPreset()!;
    return this.editingRegion() === 'camera' ? p.camera : p.gameplay;
  }

  onRegionMouseDown(e: MouseEvent) {
    if (!this.currentPreset()) return;
    const m = this._mouseNorm(e);
    this.interaction = {
      mode: 'draw', handle: '',
      startX: m.x, startY: m.y, startRegion: { x: m.x, y: m.y, w: 0, h: 0 },
    };
    this.draggingRegion.set(true);
    this._applyInteraction(m.x, m.y);
    e.preventDefault();
  }

  onBoxDown(e: MouseEvent, which: 'camera' | 'gameplay') {
    if (!this.currentPreset()) return;
    // Clicking a box auto-selects it as the region being edited.
    if (this.editingRegion() !== which) this.editingRegion.set(which);
    const region = which === 'camera'
      ? this.currentPreset()!.camera : this.currentPreset()!.gameplay;
    const m = this._mouseNorm(e);
    this.interaction = {
      mode: 'move', handle: '',
      startX: m.x, startY: m.y, startRegion: { ...region },
    };
    this.draggingRegion.set(true);
    e.stopPropagation();
    e.preventDefault();
  }

  onHandleDown(e: MouseEvent, handle: string) {
    if (!this.currentPreset()) return;
    const m = this._mouseNorm(e);
    this.interaction = {
      mode: 'resize', handle,
      startX: m.x, startY: m.y, startRegion: { ...this._editingRect() },
    };
    this.draggingRegion.set(true);
    e.stopPropagation();
    e.preventDefault();
  }

  onRegionMouseMove(e: MouseEvent) {
    if (!this.interaction) return;
    const m = this._mouseNorm(e);
    this._applyInteraction(m.x, m.y);
  }

  onRegionMouseUp() {
    this.interaction = null;
    this.draggingRegion.set(false);
  }

  private _clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

  // Mouse position normalized (0–1) against the .region-canvas element, which
  // is the canvas itself for canvas handlers and an ancestor for box/handle ones.
  private _mouseNorm(e: MouseEvent): { x: number; y: number } {
    const el = e.currentTarget as HTMLElement;
    const canvas = (el.closest('.region-canvas') as HTMLElement) ?? el;
    const rect = canvas.getBoundingClientRect();
    // getBoundingClientRect() is the border box, but the image and region boxes
    // are positioned against the inner (padding) box. Offset by the border
    // (clientLeft/Top) and use the inner size (clientWidth/Height) so 0–1 lines
    // up exactly with the frame edges.
    return {
      x: this._clamp01((e.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth),
      y: this._clamp01((e.clientY - rect.top - canvas.clientTop) / canvas.clientHeight),
    };
  }

  private _applyInteraction(mx: number, my: number) {
    const it = this.interaction;
    if (!it) return;
    const MIN = 0.02;
    let region: Region;

    if (it.mode === 'draw') {
      region = {
        x: Math.min(it.startX, mx), y: Math.min(it.startY, my),
        w: Math.abs(mx - it.startX), h: Math.abs(my - it.startY),
      };
    } else if (it.mode === 'move') {
      const dx = mx - it.startX, dy = my - it.startY;
      const w = it.startRegion.w, h = it.startRegion.h;
      region = {
        w, h,
        x: Math.max(0, Math.min(1 - w, it.startRegion.x + dx)),
        y: Math.max(0, Math.min(1 - h, it.startRegion.y + dy)),
      };
      this.patchCurrentPreset({ [this.editingRegion()]: region } as Partial<RegionPreset>);
      return; // move preserves size; no edge clamping needed
    } else { // resize — move whichever edges the handle controls
      let left = it.startRegion.x, right = it.startRegion.x + it.startRegion.w;
      let top = it.startRegion.y, bottom = it.startRegion.y + it.startRegion.h;
      const h = it.handle;
      if (h.includes('w')) left = mx;
      if (h.includes('e')) right = mx;
      if (h.includes('n')) top = my;
      if (h.includes('s')) bottom = my;
      if (right < left) [left, right] = [right, left];
      if (bottom < top) [top, bottom] = [bottom, top];
      region = { x: left, y: top, w: right - left, h: bottom - top };
    }

    // Clamp into frame + enforce a minimum size (draw/resize).
    region.x = this._clamp01(region.x);
    region.y = this._clamp01(region.y);
    region.w = Math.max(MIN, Math.min(1 - region.x, region.w));
    region.h = Math.max(MIN, Math.min(1 - region.y, region.h));
    this.patchCurrentPreset({ [this.editingRegion()]: region } as Partial<RegionPreset>);
  }

  clearImage() { this.patchCurrentPreset({ image: '' }); }

  // ── Reference-frame picker (upload a short, scrub, grab a frame) ─────────────
  onVideoUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.currentPreset()) return;
    this._revokeVideo();
    this.videoUrl.set(URL.createObjectURL(file));
    this.videoDuration.set(0);
    this.videoTime.set(0);
    this.pickingFrame.set(true);
    input.value = '';
  }

  onVideoMeta(v: HTMLVideoElement) { this.videoDuration.set(v.duration || 0); }
  onVideoTime(v: HTMLVideoElement) { this.videoTime.set(v.currentTime || 0); }

  seekVideo(v: HTMLVideoElement, e: Event) {
    const t = +(e.target as HTMLInputElement).value;
    v.currentTime = t;
    this.videoTime.set(t);
  }

  captureFrame(v: HTMLVideoElement) {
    if (!this.currentPreset()) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) { this.regionsSaveError.set('Frame not ready yet'); return; }
    const maxW = 360;
    const scale = Math.min(1, maxW / vw);
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    this.patchCurrentPreset({ image: canvas.toDataURL('image/jpeg', 0.7) });
    this.cancelFramePicker();
  }

  cancelFramePicker() {
    this.pickingFrame.set(false);
    this._revokeVideo();
  }

  private _revokeVideo() {
    const u = this.videoUrl();
    if (u) URL.revokeObjectURL(u);
    this.videoUrl.set('');
  }

  formatTime(secs: number): string {
    if (!isFinite(secs) || secs < 0) secs = 0;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async saveRegions() {
    this.regionsSaving.set(true);
    this.regionsSaveError.set('');
    this.regionsSaveDone.set(false);
    try {
      const body = JSON.stringify({
        region_presets: this.regionPresets(),
        active_preset: this.activePreset(),
      });
      const res = await fetch('/launcher/subtitler-settings/regions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.regionsSaveDone.set(true);
      setTimeout(() => this.regionsSaveDone.set(false), 2000);
    } catch (e: any) {
      this.regionsSaveError.set(e?.message ?? 'Save failed');
    } finally {
      this.regionsSaving.set(false);
    }
  }

  // ── File actions ───────────────────────────────────────────────────────────
  async browseFiles() {
    try {
      const res = await fetch('/shorts-editor/files/browse');
      if (!res.ok) return;
      const { paths } = await res.json();
      if (!paths?.length) return;
      await fetch('/shorts-editor/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      await this._refreshFiles();
    } catch (e) { console.error('Browse failed:', e); }
  }

  async removeFile(index: number, event: MouseEvent) {
    event.stopPropagation();
    await fetch(`/shorts-editor/files/${index}`, { method: 'DELETE' }).catch(() => {});
    await this._refreshFiles();
  }

  async clearFiles() {
    await fetch('/shorts-editor/files', { method: 'DELETE' }).catch(() => {});
    await this._refreshFiles();
  }

  async resetFiles() {
    await fetch('/shorts-editor/files/reset', { method: 'POST' }).catch(() => {});
    await this._refreshFiles();
  }

  private async _refreshFiles() {
    const res = await fetch('/shorts-editor/files').catch(() => null);
    if (res?.ok) this.files.set(await res.json());
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async browseOutputDir() {
    try {
      const res = await fetch('/shorts-editor/settings/browse-dir');
      if (!res.ok) return;
      const { path } = await res.json();
      if (path) {
        this.settings.update(s => ({ ...s, output_dir: path }));
        await this.refreshLogFiles();
      }
    } catch { /* silent */ }
  }

  async saveSettings() {
    this.saving.set(true);
    this.saveError.set('');
    this.saveDone.set(false);
    try {
      // Always persist via launcher (no API required)
      const res = await fetch('/launcher/subtitler-settings/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.settings()),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Also sync to running API instance if online
      if (this.apiOnline()) {
        await fetch('/shorts-editor/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings()),
        }).catch(() => {});
      }

      this.saveDone.set(true);
      setTimeout(() => this.saveDone.set(false), 2000);
      await this._refreshFiles();
      await this.refreshLogFiles();
    } catch (e: any) {
      this.saveError.set(e?.message ?? 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Processing control ─────────────────────────────────────────────────────
  async startProcessing() {
    await fetch('/shorts-editor/process/start', { method: 'POST' }).catch(() => {});
    await this.poll();
  }

  async stopProcessing() {
    await fetch('/shorts-editor/process/stop', { method: 'POST' }).catch(() => {});
    await this.poll();
  }

  async clearLogs() {
    await fetch('/shorts-editor/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }
}