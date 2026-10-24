import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { PollingComponent } from '../../shared/polling.component';

interface ScoutCounts {
  channels: number;
  videos: number;
  snapshots: number;
  outliers: number;
  analyses: number;
  query_bank: number;
  channels_pending: number;
  channels_admitted: number;
  channels_rejected: number;
  channels_evicted: number;
  outliers_unanalyzed: number;
  quota_today: number;
}

interface ScoutStatus {
  running: boolean;
  stage: string | null;
  error: string | null;
  last_result: string | null;
  counts: ScoutCounts;
}

interface GameHeatRow {
  game: string;
  outliers: number;
  score: number;
  views: number;
  velocity: number;
  examples: Array<{ video_id: string; title: string; breakout: number; views: number; channel: string }>;
}

interface AudioCraft {
  punchline_sfx_pct: number;
  sfx_types: Record<string, number>;
  music_usage: Record<string, number>;
  audio_gags: Record<string, number>;
  silence_before_scare_pct: number;
  median_sound_events_per_10s: number | null;
}

interface Exemplar {
  video_id: string;
  title: string;
  channel: string;
  breakout: number;
  views: number;
  game: string;
  why_it_worked: string;
  transferable_techniques: string[];
}

interface Feed {
  generated_at?: string;
  window_days?: number;
  totals?: { outliers: number; analyzed: number; roster: number };
  game_heat?: GameHeatRow[];
  technique_trends?: {
    sample_size: number;
    axes: Record<string, Array<{ tag: string; count: number; pct: number }>>;
    audio_craft: AudioCraft;
  };
  exemplars?: Exemplar[];
}

const STAGES = ['weekly', 'discover', 'qualify', 'poll', 'outliers', 'analyze', 'report'] as const;
type Stage = (typeof STAGES)[number];

@Component({
  selector: 'app-scout-page',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './scout-page.component.html',
  styleUrl: './scout-page.component.scss',
})
export class ScoutPageComponent extends PollingComponent {
  protected override pollingInterval = 3000;

  readonly stages = STAGES;

  apiOnline     = signal(false);
  svcState      = signal<string>('unknown');     // launcher's view of the service
  starting      = signal(false);
  status        = signal<ScoutStatus | null>(null);
  feed          = signal<Feed | null>(null);
  logs          = signal<string[]>([]);
  lastUpdated   = signal('—');
  actionError   = signal<string | null>(null);

  counts = computed(() => this.status()?.counts ?? null);
  running = computed(() => this.status()?.running ?? false);

  trends = computed(() => this.feed()?.technique_trends ?? null);
  audio  = computed(() => this.trends()?.audio_craft ?? null);

  // Top technique axes worth surfacing on the page (full set is in the feed).
  readonly trendAxes = [
    'payoff_technique', 'hook_type', 'audio_elements', 'cut_density',
    'on_screen_text_style', 'visual_effects', 'humor_mechanics',
  ];

  async poll(): Promise<void> {
    // Launcher's view (is the process up at all?)
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        const svcs: Array<{ id: string; status: string }> = await res.json();
        const svc = svcs.find(s => s.id === 'shorts_scout_api');
        this.svcState.set(svc?.status ?? 'unknown');
      }
    } catch { /* launcher offline */ }

    // Scout API itself.
    try {
      const [st, lg, fd] = await Promise.all([
        fetch('/shorts-scout/status'),
        fetch('/shorts-scout/logs?last=150'),
        fetch('/shorts-scout/feed'),
      ]);
      if (!st.ok) throw new Error('status not ok');
      this.status.set(await st.json());
      this.apiOnline.set(true);
      if (lg.ok) this.logs.set((await lg.json()).lines ?? []);
      if (fd.ok) {
        const feed = await fd.json();
        this.feed.set(feed && Object.keys(feed).length ? feed : null);
      }
      this.lastUpdated.set(new Date().toLocaleTimeString());
    } catch {
      this.apiOnline.set(false);
    }
  }

  async startService(): Promise<void> {
    this.starting.set(true);
    this.actionError.set(null);
    try {
      await fetch('/launcher/services/shorts_scout_api/start', { method: 'POST' });
    } catch (e: any) {
      this.actionError.set(`start failed: ${e?.message ?? e}`);
    } finally {
      setTimeout(() => this.starting.set(false), 4000);
    }
  }

  async run(task: Stage): Promise<void> {
    this.actionError.set(null);
    try {
      const res = await fetch('/shorts-scout/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        this.actionError.set(body?.detail ?? `run ${task} failed (${res.status})`);
      }
      await this.poll();
    } catch (e: any) {
      this.actionError.set(`run ${task} failed: ${e?.message ?? e}`);
    }
  }

  objEntries(o: Record<string, number> | undefined | null): Array<[string, number]> {
    return o ? Object.entries(o).sort((a, b) => b[1] - a[1]) : [];
  }

  shortUrl(id: string): string {
    return `https://www.youtube.com/shorts/${id}`;
  }

  fmtViews(n: number | undefined): string {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
    return String(n);
  }
}
