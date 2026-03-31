import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavSidebarComponent } from './components/sidebar/sidebar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavSidebarComponent],
  template: `
    <app-sidebar />
    <router-outlet></router-outlet>
  `,
  styles: [`:host { display: block; height: 100vh; overflow: hidden; }`]
})
export class AppComponent {}