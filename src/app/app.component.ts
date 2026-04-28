import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavSidebarComponent } from './components/sidebar/sidebar.component';
import { StatusRibbonComponent } from './components/status-ribbon/status-ribbon.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavSidebarComponent, StatusRibbonComponent],
  template: `
    <app-sidebar />
    <app-status-ribbon />
    <router-outlet></router-outlet>
  `,
  styles: [`:host { display: block; height: 100vh; overflow: hidden; }`]
})
export class AppComponent {}