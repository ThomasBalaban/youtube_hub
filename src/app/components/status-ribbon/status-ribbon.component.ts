import { Component, signal } from '@angular/core';
import { PollingComponent } from '../../shared/polling.component';

interface ServiceStatus {
  id: string;
  label: string;
  status: 'online' | 'offline' | 'starting' | 'stopping' | 'unhealthy' | string;
  pid: number | null;
  is_gui: boolean;
  managed: boolean;
  color_hint: string;
  health_check: string;
}

interface ThinkerStatus {
  state: 'stopped' | 'running' | 'idle' | 'error';
  queue_depth: number;
  current_task: { task_type: string; key: string } | null;
}

const REQUIRED_API_IDS = ['shorts_auto_editor_api', 'shorts_analyzer_api', 'shorts_strategist_api'];

@Component({
  selector: 'app-status-ribbon',
  standalone: true,
  template: `
    <div class="ribbon">
      <div class="ribbon-left">
        <span class="ribbon-launcher" [class.off]="!launcherOnline()">
          <span class="dot" [class.online]="launcherOnline()"></span>
          Launcher
        </span>
      </div>

      <div class="ribbon-services">
        @for (s of services(); track s.id) {
          <span class="svc"
                [class.svc-online]="s.status === 'online'"
                [class.svc-offline]="s.status === 'offline'"
                [class.svc-pending]="s.status === 'starting' || s.status === 'stopping'"
                [class.svc-bad]="s.status === 'unhealthy'"
                [title]="s.label + ' — ' + s.status">
            <span class="svc-dot"></span>
            {{ shortLabel(s) }}
          </span>
        }
        @if (!services().length && launcherOnline()) {
          <span class="svc-empty">No services</span>
        }
      </div>

      <div class="ribbon-right">
        <span class="thinker-pill" [attr.data-state]="thinkerPillState()"
              [title]="strategistOnline() ? '' : 'Shorts Strategist API is offline'">
          <span class="thinker-dot"></span>
          <span class="thinker-label">Thinker</span>
          <span class="thinker-state">{{ thinkerStateLabel() }}</span>
          @if ((thinker()?.queue_depth ?? 0) > 0) {
            <span class="thinker-q">{{ thinker()?.queue_depth }}</span>
          }
        </span>

        <button class="ribbon-btn ribbon-btn--small ribbon-btn--ghost"
                (click)="clearThinkerQueue()"
                [disabled]="thinkerBusy() || !strategistOnline()"
                title="Mark all stale tasks as 'skipped' without running them. Forced tasks are unaffected.">
          ✕ Queue
        </button>

        <button class="ribbon-btn ribbon-btn--small"
                [class.ribbon-btn--stop]="thinkerRunning() && !thinkerBusy()"
                (click)="toggleThinker()"
                [disabled]="thinkerBusy() || !strategistOnline()"
                [title]="strategistOnline() ? 'Start or stop the strategist thinker loop' : 'Start the Shorts Strategist API first'">
          @if (thinkerBusy()) {
            <span class="btn-spin"></span>
          } @else if (thinkerRunning()) {
            ■
          } @else {
            ▶
          }
          Thinker
        </button>

        <button class="ribbon-btn"
                [class.ribbon-btn--stop]="apisReady() && !busy()"
                (click)="toggleApis()"
                [disabled]="!launcherOnline() || busy()">
          @if (busy()) {
            <span class="btn-spin"></span>
            {{ busyLabel() }}
          } @else if (apisReady()) {
            ■ Stop APIs
          } @else {
            ▶ Start APIs
          }
        </button>
      </div>
    </div>
  `,
  styleUrl: './status-ribbon.component.scss',
})
export class StatusRibbonComponent extends PollingComponent {
  protected override pollingInterval = 3000;

  services       = signal<ServiceStatus[]>([]);
  launcherOnline = signal(false);
  busy           = signal(false);
  busyLabel      = signal('Starting…');

  // Thinker state — populated when shorts_strategist_api is online.
  thinker        = signal<ThinkerStatus | null>(null);
  thinkerBusy    = signal(false);

  apisReady = () => {
    const svcs = this.services();
    return REQUIRED_API_IDS.every(
      id => svcs.find(s => s.id === id)?.status === 'online',
    );
  };

  strategistOnline = () =>
    this.services().find(s => s.id === 'shorts_strategist_api')?.status === 'online';

  thinkerRunning = () => {
    const s = this.thinker()?.state;
    return s === 'running' || s === 'idle';
  };

  thinkerStateLabel = () => {
    if (!this.strategistOnline()) return 'offline';
    switch (this.thinker()?.state) {
      case 'running': return 'running';
      case 'idle':    return 'idle';
      case 'error':   return 'error';
      case 'stopped': return 'stopped';
      default:        return '—';
    }
  };

  thinkerPillState = () => {
    if (!this.strategistOnline()) return 'offline';
    return this.thinker()?.state ?? 'unknown';
  };

  shortLabel(s: ServiceStatus): string {
    return s.label.replace(/\s*\(GUI\)\s*$/, '').replace(/\s*API\s*$/, '');
  }

  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        this.services.set(await res.json());
      } else {
        this.launcherOnline.set(false);
      }
    } catch {
      this.launcherOnline.set(false);
    }

    // Pull thinker status only when the strategist API is online — saves
    // a noisy 404/connection-refused on every tick when it isn't.
    if (this.strategistOnline()) {
      try {
        const r = await fetch('/shorts-strategist/thinker/status');
        if (r.ok) this.thinker.set(await r.json() as ThinkerStatus);
      } catch {
        // Leave the prior thinker value; we'll retry next tick.
      }
    } else {
      this.thinker.set(null);
    }
  }

  async toggleThinker() {
    if (this.thinkerBusy() || !this.strategistOnline()) return;
    const action = this.thinkerRunning() ? 'stop' : 'start';
    this.thinkerBusy.set(true);
    try {
      const r = await fetch(`/shorts-strategist/thinker/${action}`, { method: 'POST' });
      if (r.ok) this.thinker.set(await r.json() as ThinkerStatus);
    } finally {
      this.thinkerBusy.set(false);
      // Re-poll to catch transient state changes.
      setTimeout(() => this.poll(), 800);
    }
  }

  async clearThinkerQueue() {
    if (this.thinkerBusy() || !this.strategistOnline()) return;
    const depth = this.thinker()?.queue_depth ?? 0;
    const msg = depth > 0
      ? `Clear ${depth} pending task${depth === 1 ? '' : 's'}? Each will be marked "skipped by operator" with no LLM call. Forced tasks are unaffected.`
      : 'No queued tasks. Clear anyway? (will be a no-op)';
    if (!confirm(msg)) return;
    this.thinkerBusy.set(true);
    try {
      const r = await fetch('/shorts-strategist/thinker/clear-stale', { method: 'POST' });
      if (r.ok) {
        const data = await r.json();
        console.log(`Cleared ${data.skipped} stale task(s).`);
      }
      await this.poll();
    } finally {
      this.thinkerBusy.set(false);
    }
  }

  async toggleApis() {
    if (this.busy() || !this.launcherOnline()) return;
    if (this.apisReady()) {
      await this.stopApis();
    } else {
      await this.startApis();
    }
  }

  async startApis() {
    this.busy.set(true);
    this.busyLabel.set('Starting…');
    try {
      const svcs = this.services();
      const toStart = REQUIRED_API_IDS.filter(id => {
        const s = svcs.find(x => x.id === id);
        return !s || s.status !== 'online';
      });
      await Promise.allSettled(
        toStart.map(id =>
          fetch(`/launcher/services/${id}/start`, { method: 'POST' }),
        ),
      );
      await this.poll();
      setTimeout(() => this.poll(), 2500);
    } finally {
      this.busy.set(false);
    }
  }

  async stopApis() {
    this.busy.set(true);
    this.busyLabel.set('Stopping…');
    try {
      const svcs = this.services();
      const toStop = REQUIRED_API_IDS.filter(id => {
        const s = svcs.find(x => x.id === id);
        return s && s.status !== 'offline';
      });
      await Promise.allSettled(
        toStop.map(id =>
          fetch(`/launcher/services/${id}/stop`, { method: 'POST' }),
        ),
      );
      await this.poll();
      setTimeout(() => this.poll(), 2500);
    } finally {
      this.busy.set(false);
    }
  }
}
