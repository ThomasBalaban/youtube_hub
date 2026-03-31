import { Routes } from '@angular/router';
import { HubPageComponent } from './components/hub-page/hub-page.component';
import { PublisherPageComponent } from './components/publisher-page/publisher-page.component';

export const routes: Routes = [
  { path: 'publisher', component: PublisherPageComponent },
  { path: '**', component: HubPageComponent },
];