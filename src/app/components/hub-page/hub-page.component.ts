import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface AppCard {
  route: string;
  icon: string;
  title: string;
  description: string;
  color: string;
}

@Component({
  selector: 'app-hub-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './hub-page.component.html',
  styleUrl: './hub-page.component.scss',
})
export class HubPageComponent {
  cards: AppCard[] = [
    {
      route: '/subtitler',
      icon: '💬',
      title: 'SimpleAutoSubs',
      description: 'Queue gaming clips, add comic-book onomatopoeia overlays, transcribe mic & desktop audio, and generate AI-powered titles — all without opening the GUI.',
      color: '#34d399',
    },
    {
      route: '/publisher',
      icon: '▶',
      title: 'YouTube Shorts Publisher',
      description: 'Configure the run mode (AI Analysis, Scraper, or Publish), adjust settings, and launch the Playwright browser automation that schedules your draft Shorts.',
      color: '#f87171',
    },
  ];
}