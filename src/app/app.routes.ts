import { Routes } from '@angular/router';
import { HubPageComponent } from './components/hub-page/hub-page.component';
import { PublisherPageComponent } from './components/publisher-page/publisher-page.component';
import { SubtitlerPageComponent } from './components/subtitler-page/subtitler-page.component';

export const routes: Routes = [
  { path: 'publisher',  component: PublisherPageComponent },
  { path: 'subtitler',  component: SubtitlerPageComponent },
  { path: '**',         component: HubPageComponent },
];