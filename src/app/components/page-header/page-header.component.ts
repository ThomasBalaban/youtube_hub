import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatusRibbonComponent } from '../status-ribbon/status-ribbon.component';
import { YoutubeAccountComponent } from '../youtube-account/youtube-account.component';

/**
 * Shared header for every routed page.
 *
 * Layout:
 *   ┌─────────────────────────────────────┬──────────┐
 *   │ Status Ribbon                       │          │
 *   ├─────────────────────────────────────┤  YouTube │
 *   │ ← Hub │ Title  │ sub-label          │  Account │
 *   └─────────────────────────────────────┴──────────┘
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [RouterLink, StatusRibbonComponent, YoutubeAccountComponent],
  template: `
    <div class="page-header">
      <div class="header-main">
        <app-status-ribbon class="ribbon-host" />

        <div class="header-row">
          @if (showBack) {
            <a routerLink="/" class="back-btn" title="Back to Hub">
              <span>←</span><span>Hub</span>
            </a>
          }
          <h1 class="page-title">
            @if (icon) {
              <span class="icon" [style.color]="iconColor || null">{{ icon }}</span>
            }
            {{ title }}
          </h1>
          @if (subLabel) {
            <span class="sub-label">{{ subLabel }}</span>
          }
        </div>
      </div>

      <app-youtube-account class="account-host" />
    </div>
  `,
  styleUrl: './page-header.component.scss',
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() icon = '';
  @Input() iconColor = '';
  @Input() subLabel = '';
  @Input() showBack = true;
}
