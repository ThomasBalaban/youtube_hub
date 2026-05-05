import { Routes } from '@angular/router';
import { HubPageComponent } from './components/hub-page/hub-page.component';
import { PublisherPageComponent } from './components/publisher-page/publisher-page.component';
import { SubtitlerPageComponent } from './components/subtitler-page/subtitler-page.component';
import { BacktrackPageComponent } from './components/backtrack-page/backtrack-page.component';
import { AutoRunPageComponent } from './components/auto-run-page/auto-run-page.component';
import { ShortsAnalyzerPageComponent } from './components/shorts-analyzer-page/shorts-analyzer-page.component';
import { StrategistPageComponent } from './components/strategist-page/strategist-page.component';

export const routes: Routes = [
  { path: 'auto-run',         component: AutoRunPageComponent },
  { path: 'backtrack',        component: BacktrackPageComponent },
  { path: 'publisher',        component: PublisherPageComponent },
  { path: 'shorts-editor',    component: SubtitlerPageComponent },
  { path: 'shorts-analyzer',  component: ShortsAnalyzerPageComponent },
  { path: 'strategist',       component: StrategistPageComponent },
  { path: '**',               component: HubPageComponent },
];
