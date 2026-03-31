import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PollingComponent } from '../../shared/polling.component';

interface ServiceDetail {
  id:            string;
  label:         string;
  description:   string;
  port:          number | null;
  managed:       boolean;
  health_check:  string;
  is_gui:        boolean;
  color_hint:    string;
  status:        'online' | 'offline' | 'starting' | 'stopping' | 'unhealthy' | 'unknown';
  pid:           number | null;
  cwd:           string;
  logs?:         string[];
  logsOpen?:     boolean;
  actionPending?: boolean;
}

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  online:    { label: 'Running',   color: '#22c55e', icon: '●' },
  offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
  starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
  stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
  unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
  unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
};

@Component({
  selector: 'app-hub-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hub-page.component.html',
  styleUrl: './hub-page.component.scss',
})
export class HubPageComponent extends PollingComponent {
  protected override pollingInterval = 4000;

  services       = signal<ServiceDetail[]>([]);
  launcherOnline = signal(false);
  loading        = signal(false);
  lastUpdated    = signal('—');
  bulkPending    = signal(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  statusMeta(status: string) {
    return STATUS_META[status] ?? STATUS_META['unknown'];
  }

  openVscode(svc: ServiceDetail): void {
    if (svc.cwd) window.open(`vscode://file/${svc.cwd}`);
  }

  isErr  = (l: string) => /error|failed|exception|traceback|fatal/i.test(l);
  isOk   = (l: string) => /✅|healthy|ready|started|running/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  // ── Polling ────────────────────────────────────────────────────────────────

  override async poll() {
    this.loading.set(true);
    try {
      const res = await fetch('/launcher/services');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const fresh: ServiceDetail[] = await res.json();
      this.launcherOnline.set(true);
      this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());

      const current = this.services();
      this.services.set(fresh.map(s => {
        const ex = current.find(c => c.id === s.id);
        return {
          ...s,
          logs:          ex?.logs ?? [],
          logsOpen:      ex?.logsOpen ?? false,
          actionPending: false,
        };
      }));

      // Auto-refresh any open log panels
      for (const svc of this.services()) {
        if (svc.logsOpen) this.refreshLogs(svc);
      }
    } catch {
      this.launcherOnline.set(false);
      this.lastUpdated.set('Launcher offline');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Service actions ────────────────────────────────────────────────────────

  async action(svc: ServiceDetail, act: 'start' | 'stop' | 'restart') {
    this.setPending(svc.id, true);
    try {
      await fetch(`/launcher/services/${svc.id}/${act}`, { method: 'POST' });
      await this.poll();
      // Extra poll after a delay so status settles
      if (act !== 'stop') setTimeout(() => this.poll(), 2500);
    } finally {
      this.setPending(svc.id, false);
    }
  }

  async startAll() {
    if (!this.launcherOnline() || this.bulkPending()) return;
    const toStart = this.services().filter(s => s.managed && s.status === 'offline');
    if (!toStart.length) return;

    this.bulkPending.set(true);
    toStart.forEach(s => this.setPending(s.id, true));
    try {
      await Promise.all(toStart.map(s =>
        fetch(`/launcher/services/${s.id}/start`, { method: 'POST' })
      ));
      await this.poll();
      setTimeout(() => this.poll(), 3000);
    } finally {
      toStart.forEach(s => this.setPending(s.id, false));
      this.bulkPending.set(false);
    }
  }

  async stopAll() {
    if (!this.launcherOnline() || this.bulkPending()) return;
    const toStop = this.services().filter(s => s.managed && s.status === 'online');
    if (!toStop.length) return;

    this.bulkPending.set(true);
    toStop.forEach(s => this.setPending(s.id, true));
    try {
      await Promise.all(toStop.map(s =>
        fetch(`/launcher/services/${s.id}/stop`, { method: 'POST' })
      ));
      await this.poll();
    } finally {
      toStop.forEach(s => this.setPending(s.id, false));
      this.bulkPending.set(false);
    }
  }

  // ── Log panel ──────────────────────────────────────────────────────────────

  async toggleLogs(svc: ServiceDetail) {
    this.services.update(svcs =>
      svcs.map(s => s.id === svc.id ? { ...s, logsOpen: !s.logsOpen } : s)
    );
    const updated = this.services().find(s => s.id === svc.id);
    if (updated?.logsOpen) await this.refreshLogs(svc);
  }

  async refreshLogs(svc: ServiceDetail) {
    try {
      const res = await fetch(`/launcher/services/${svc.id}/logs?last=150`);
      if (!res.ok) return;
      const data = await res.json();
      this.services.update(svcs =>
        svcs.map(s => s.id === svc.id ? { ...s, logs: data.lines } : s)
      );
    } catch { /* silent */ }
  }

  async clearLogs(svc: ServiceDetail) {
    try {
      await fetch(`/launcher/services/${svc.id}/logs`, { method: 'DELETE' });
      this.services.update(svcs =>
        svcs.map(s => s.id === svc.id ? { ...s, logs: [] } : s)
      );
    } catch { /* silent */ }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private setPending(id: string, pending: boolean) {
    this.services.update(svcs =>
      svcs.map(s => s.id === id ? { ...s, actionPending: pending } : s)
    );
  }
}
