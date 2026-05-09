import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from './components/app-shell/app-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppShellComponent],
  template: `
    <app-shell>
      <router-outlet></router-outlet>
    </app-shell>
  `,
  styles: [`:host { display: block; height: 100vh; overflow: hidden; }`]
})
export class AppComponent {}
