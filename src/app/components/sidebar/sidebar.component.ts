import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface AccountInfo {
  channel_id?: string;
  title?: string;
  handle?: string;
  avatar_url?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="sidebar">
      <div class="sidebar-logo" [title]="account()?.title || 'YouTube Hub'">
        @if (account()?.avatar_url) {
          <img class="avatar" [src]="account()!.avatar_url" alt=""
               referrerpolicy="no-referrer" />
          <div class="account-name">{{ account()!.title }}</div>
        } @else {
          <div class="avatar-fallback">YH</div>
        }
      </div>

      <a routerLink="/"
         routerLinkActive="active"
         [routerLinkActiveOptions]="{ exact: true }"
         class="nav-item"
         title="Home">
        <span class="nav-icon">🏠</span>
        <span class="nav-label">Home</span>
      </a>

      <a routerLink="/backtrack"
         routerLinkActive="active"
         class="nav-item"
         title="Backtrack Scanner">
        <span class="nav-icon">🔍</span>
        <span class="nav-label">Scan</span>
      </a>

      <a routerLink="/shorts-editor"
         routerLinkActive="active"
         class="nav-item"
         title="Shorts Auto Editor">
        <span class="nav-icon">💬</span>
        <span class="nav-label">Editor</span>
      </a>

      <a routerLink="/publisher"
         routerLinkActive="active"
         class="nav-item"
         title="YouTube Publisher">
        <span class="nav-icon">▶</span>
        <span class="nav-label">Publish</span>
      </a>

      <a routerLink="/shorts-analyzer"
         routerLinkActive="active"
         class="nav-item"
         title="Shorts Analyzer">
        <span class="nav-icon">📊</span>
        <span class="nav-label">Analyze</span>
      </a>

      <a routerLink="/strategist"
         routerLinkActive="active"
         class="nav-item"
         title="Shorts Strategist">
        <span class="nav-icon">🧠</span>
        <span class="nav-label">Strategy</span>
      </a>
    </nav>
  `,
  styleUrl: './sidebar.component.scss',
})
export class NavSidebarComponent implements OnInit {
  account = signal<AccountInfo | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const res = await fetch('/launcher/account/me');
      if (!res.ok) return;
      const data = (await res.json()) as AccountInfo;
      this.account.set(data);
    } catch {
      // Launcher not running yet, or no OAuth token. Sidebar shows "YH" fallback.
    }
  }
}
