import { Routes } from '@angular/router';
import { HubPageComponent } from './components/hub-page/hub-page.component';
import { PublisherPageComponent } from './components/publisher-page/publisher-page.component';
import { SubtitlerPageComponent } from './components/subtitler-page/subtitler-page.component';
import { BacktrackPageComponent } from './components/backtrack-page/backtrack-page.component';

export const routes: Routes = [
  { path: 'backtrack',  component: BacktrackPageComponent },
  { path: 'publisher',  component: PublisherPageComponent },
  { path: 'subtitler',  component: SubtitlerPageComponent },
  { path: '**',         component: HubPageComponent },
];