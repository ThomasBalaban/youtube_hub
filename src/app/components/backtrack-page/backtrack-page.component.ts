import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PollingComponent } from '../../shared/polling.component';

interface ServiceStatus { id: string; status: string; pid: number | null; }

interface DataFileMeta {
  key: string;
  label: string;
  description: string;
  path: string;
  exists: boolean;
  size: number;
  modified: number | null;
}

@Component({
  selector: 'app-backtrack-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './backtrack-page.component.html',
  styleUrl: './backtrack-page.component.scss',
})
export class BacktrackPageComponent extends PollingComponent {
  protected override pollingInterval = 2500;

  serviceStatus = signal<ServiceStatus | null>(null);
  launcherOnline = signal(false);
  actionPending = signal(false);
  logs = signal<string[]>([]);
  lastUpdated = signal('—');

  // Data Viewer State
  dataFiles = signal<DataFileMeta[]>([]);
  dataViewState = signal<'list' | 'file'>('list');
  selectedFile = signal<DataFileMeta | null>(null);
  selectedContent = signal<Record<string, string> | null>(null);
  dataLoading = signal(false);

  isRunning = computed(() => this.serviceStatus()?.status === 'online');
  isStarting = computed(() => this.serviceStatus()?.status === 'starting');

  // Convert the dictionary object into an array for easy looping in HTML
  parsedContentList = computed(() => {
    const content = this.selectedContent();
    if (!content) return [];
    return Object.entries(content).map(([filename, timestamp]) => ({ filename, timestamp }));
  });

  statusMeta = computed(() => {
    const s = this.serviceStatus()?.status ?? 'unknown';
    const map: Record<string, { label: string; color: string; icon: string }> = {
      online:    { label: 'Running',   color: '#22c55e', icon: '●' },
      offline:   { label: 'Stopped',   color: '#4b5563', icon: '○' },
      starting:  { label: 'Starting',  color: '#3b82f6', icon: '◌' },
      stopping:  { label: 'Stopping',  color: '#f59e0b', icon: '◌' },
      unhealthy: { label: 'Unhealthy', color: '#ef4444', icon: '⚠' },
      unknown:   { label: 'Unknown',   color: '#6b7280', icon: '?' },
    };
    return map[s] ?? map['unknown'];
  });

  isErr = (l: string) => /error|failed|exception|abort/i.test(l);
  isOk = (l: string) => /✅|success|completed|rebuilt/i.test(l);
  isWarn = (l: string) => /warn|warning|⚠/i.test(l);

  override async poll() {
    try {
      const res = await fetch('/launcher/services');
      if (res.ok) {
        this.launcherOnline.set(true);
        const svcs: ServiceStatus[] = await res.json();
        this.serviceStatus.set(svcs.find(s => s.id === 'backtrack_scanner') ?? null);
        this.lastUpdated.set('Updated ' + new Date().toLocaleTimeString());
      } else {
        this.launcherOnline.set(false);
      }
    } catch {
      this.launcherOnline.set(false);
      this.lastUpdated.set('Launcher offline');
    }
    
    await this.refreshLogs();
    
    // Refresh files if we are on the list view
    if (this.dataViewState() === 'list') {
      await this.refreshDataFiles();
    }
  }

  async serviceAction(act: 'start' | 'stop') {
    if (!this.launcherOnline() || this.actionPending()) return;
    this.actionPending.set(true);
    try {
      await fetch(`/launcher/services/backtrack_scanner/${act}`, { method: 'POST' });
      await this.poll();
    } finally {
      this.actionPending.set(false);
    }
  }

  async refreshLogs() {
    if (!this.launcherOnline()) return;
    const res = await fetch('/launcher/services/backtrack_scanner/logs?last=300').catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.logs.set(d.lines ?? []);
    }
  }

  async clearLogs() {
    await fetch('/launcher/services/backtrack_scanner/logs', { method: 'DELETE' }).catch(() => {});
    this.logs.set([]);
  }

  // --- Data Viewer Methods ---
  async refreshDataFiles() {
    if (!this.launcherOnline()) return;
    const res = await fetch('/launcher/backtrack/data/files').catch(() => null);
    if (res?.ok) this.dataFiles.set(await res.json());
  }

  async openDataFile(file: DataFileMeta) {
    if (!file.exists) return;
    this.selectedFile.set(file);
    this.dataViewState.set('file');
    this.dataLoading.set(true);
    this.selectedContent.set(null);
    
    const res = await fetch(`/launcher/backtrack/data/file?key=${file.key}`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      this.selectedContent.set(d.data);
    }
    this.dataLoading.set(false);
  }

  backToDataList() {
    this.dataViewState.set('list');
    this.selectedFile.set(null);
    this.selectedContent.set(null);
    this.refreshDataFiles();
  }

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
}