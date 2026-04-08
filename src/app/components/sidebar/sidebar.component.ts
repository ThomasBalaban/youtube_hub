import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="sidebar">
      <div class="sidebar-logo">YH</div>

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

      <a routerLink="/subtitler"
         routerLinkActive="active"
         class="nav-item"
         title="SimpleAutoSubs">
        <span class="nav-icon">💬</span>
        <span class="nav-label">Subs</span>
      </a>

      <a routerLink="/publisher"
         routerLinkActive="active"
         class="nav-item"
         title="YouTube Publisher">
        <span class="nav-icon">▶</span>
        <span class="nav-label">Publish</span>
      </a>
    </nav>
  `,
  styleUrl: './sidebar.component.scss',
})
export class NavSidebarComponent {}