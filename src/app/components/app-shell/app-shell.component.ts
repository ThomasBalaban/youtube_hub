import { Component } from '@angular/core';
import { NavSidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NavSidebarComponent],
  template: `
    <app-sidebar />
    <ng-content></ng-content>
  `,
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {}
