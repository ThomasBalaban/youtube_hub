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

const REQUIRED_API_IDS = ['simple_auto_subs_api', 'shorts_analyzer_api', 'shorts_strategist_api'];

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

  apisReady = () => {
    const svcs = this.services();
    return REQUIRED_API_IDS.every(
      id => svcs.find(s => s.id === id)?.status === 'online',
    );
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
