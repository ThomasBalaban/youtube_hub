import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface AccountInfo {
  channel_id?: string;
  title?: string;
  handle?: string;
  avatar_url?: string;
}

@Component({
  selector: 'app-youtube-account',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="account" [title]="account()?.title || 'YouTube account'">
      @if (account()?.avatar_url) {
        <img class="avatar"
             [src]="account()!.avatar_url"
             alt=""
             referrerpolicy="no-referrer" />
        <div class="meta">
          <div class="title">{{ account()!.title }}</div>
          @if (account()?.handle) {
            <div class="handle">{{ account()!.handle }}</div>
          }
        </div>
      } @else {
        <div class="placeholder">— not signed in —</div>
      }
    </div>
  `,
  styleUrl: './youtube-account.component.scss',
})
export class YoutubeAccountComponent implements OnInit {
  account = signal<AccountInfo | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const res = await fetch('/launcher/account/me');
      if (!res.ok) return;
      this.account.set((await res.json()) as AccountInfo);
    } catch {
      // Launcher not running yet, or no OAuth token. Component shows placeholder.
    }
  }
}
